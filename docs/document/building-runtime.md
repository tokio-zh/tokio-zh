# 构建一个运行时

运行时 - 运行事件驱动的应用程序所需的所有部分 - 已经可用。 如果你只想使用tokio，你不需要知道这个。 但是，知道底层发生了什么可能是有用的，既可以在出现问题时更多地了解细节，也可以在运行时生成器支持之外进行自定义。

我们将构建一个单线程运行时，因为它组合起来稍微简单一些。 并不是说默认的多线程版本在概念上会更复杂，但是有更多的移动部分。 了解这里的细节可以成为读取默认运行时代码的垫脚石。

可以在git存储库中找到此处讨论的完整，有效的[示例](https://github.com/tokio-rs/tokio/blob/master/examples/manual-runtime.rs)。

## `Park` trait

异步世界本质上是在等待某事发生（并且能够一次等待多个事物）。 毫无疑问，抽象等待是一种特质。 它叫做Park。

这个想法是，如果没有更好的事情要做，控制权将被传递到公园直到发生一些有趣的事情并且控制权再次被带走或直到某个指定的时间过去。 公园如何花费这段时间。 它可以做一些有用的事情（处理后台作业）或者只是以某种方式阻止线程。

有些东西是底层的Park实现 - 它们以某种方式阻止了线程。 实现 `trait`的其他事情只是将park调用委托给它们包装的一些底层对象（带有一些附加功能），允许将东西堆叠在一起。

## 常用的组件

我们肯定需要一个Reactor来接受来自操作系统的外部事件（比如可读的网络套接字）。它是通过mio crate阻塞epoll，kqueue或其他依赖于操作系统的原语来实现的。这不能将等待委托给任何其他东西，因此反应堆会进入堆栈的底部。

反应堆能够通过网络和类似事件通知我们的 `future`数据，但我们需要一个执行者来实际运行它们。我们将使用CurrentThread执行程序，因为我们正在构建单线程运行时。使用任何其他适合您需求的执行程序。当没有准备好运行的 `future`时，执行者需要在下面的Park等待。它没有实现Park，因此它必须位于整个堆栈的顶部。

虽然不是绝对必要，但是能够运行延迟的 `future` - 超时和类似的是有用的。因此，我们将Timer置于中间位置 - 幸运的是，它可以放置在一个Park的顶部并且还可以实现Park。对于基于IO的 `future`反应堆而言，这与超时类似。

此外，可以添加任何自定义图层。一个例子可能是某种闲置的簿记组件 - 如果被要求等待和交错，让它下面的公园也拿起事件，它会尝试重复做一些工作。如果没有簿记要做，它只会委托等待。

这就是反应堆，计时器和执行器的创建在代码中的样子：

```rust
let reactor = Reactor::new()?;
// The reactor itself will get consumed by timer,
// so we keep a handle to communicate with it.
let reactor_handle = reactor.handle();
let timer = Timer::new(reactor);
let timer_handle = timer.handle();
let mut executor = CurrentThread::new_with_park(timer);
```

这样，如果要执行 `future`，它们将首先执行。 然后，一旦它用完了准备好的 `future`，它将寻找触发超时。 这可能会产生一些更准备好的 `future`（接下来会执行）。 如果没有超时触发，则计时器计算反应堆可以安全阻塞的时间并让它等待外部事件。

## 全局状态

我们已经构建了完成实际工作的组件。 但我们需要一种方法来构建并向他们提交工作。 我们可以通过把手这样做，但要做到这一点，我们将不得不携带它们远离人体工程学。

为了避免繁琐的几个句柄传递，内置运行时将它们存储在线程本地存储中。 tokio中的几个模块有一个with_default方法，它接受相应的句柄和一个闭包。 它将句柄存储在线程本地存储中并运行闭包。 然后它在关闭完成后恢复TLS的原始值。

这样我们就可以在设置所有默认值的情况下运行 `future`，因此可以自由使用它们：

```rust
// Binds an executor to this thread
let mut enter = tokio_executor::enter()
    .expect("Multiple executors at once");
// Set the defaults before running the closure
let result = tokio_reactor::with_default(
    &reactor_handle,
    &mut enter,
    |enter| timer::with_default(
        &timer_handle,
        enter,
        |enter| {
            let mut default_executor =
                current_thread::TaskExecutor::current();
            tokio_executor::with_default(
                &mut default_executor,
                enter,
                |enter| executor.enter(enter).block_on(f)
            )
        }
    )
);
```

有一些值得注意的事情。首先，输入事物只是确保我们不会同时在同一个线程上运行多个执行程序。运行多个执行程序会使其中一个被阻止，这将以非常有用的方式起作用，因此这是防止脚步。

其次，我们希望使用与默认执行程序和默认当前线程执行程序相同的执行程序，并且还运行执行程序（不仅在不再等待的情况下将 `future`产生到它上）。要做到这两点，我们需要两个可变的引用，这是不可能的。为了解决这个问题，我们设置了当前的线程执行器（它实际上在executor.block_on调用中设置了自己，或者任何类似的线程执行器）。我们使用TaskExecutor作为默认值，它是当前线程执行程序在使用时配置的代理。

最后，block_on将执行单个future将完成（并将处理在执行程序中生成的任何其他 `future`，但如果f先完成，它将不会等待它们完成）。 `future`的结果是通过所有with_default调用向上冒泡，并且可以以任何其他方式返回或使用。如果你想等待所有其他 `future`也完成，那么还有executor.run，可以在之后执行。