# 运行时模型

使用Tokio编写的应用程序组织在大量的小型，非阻塞任务。 Tokio任务类似于[goroutine](https://www.golang-book.com/books/intro/10#section1)或者[Erlang进程](http：//erlang.org/doc/reference_manual/processes.html)，但是没有阻塞。 它们被设计成轻量级，可以快速生成，并保持低调度开销。 他们是也是非阻塞的，因为这样的操作无法立即完成必须立即返回。 而不是返回操作的结果，它们返回一个值，表明操作正在进行中。

## 非阻塞执行

使用[`Future`] trait实现Tokio任务：

```rust
struct MyTask {
    my_resource: MyResource,
}

impl Future for MyTask {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        match self.my_resource.poll() {
            Ok(Async::Ready(value)) => {
                self.process(value);
                Ok(Async::Ready(()))
            }
            Ok(Async::NotReady) => Ok(Async::NotReady),
            Err(err) => {
                self.process_err(err);
                Ok(Async::Ready(()))
            }
        }
    }
}
```

使用`tokio :: spawn`或通过调用[`Spawn`]将任务提交给执行程序执行程序对象上的方法。 `poll`函数驱动任务。没有工作没有调用`poll`就完成了。在任务上调用`poll`是执行者的工作直到`Ready（（））`返回。

`MyTask`将从`my_resource`接收一个值并处理它。一旦价值已经处理完毕，任务已完成其逻辑并完成。这是返回'Ok（Async :: Ready（（）））`表示。

但是，为了完成处理，任务取决于`my_resource`提供价值。鉴于`my_resource`是一个非阻塞任务，它可能或调用`my_resource.poll（）`时，可能还没准备好提供值。如果它准备就绪，它返回'Ok（Async :: Ready（value））`。如果没有准备好，它会返回`好（异步::未就绪）`。

当资源未准备好提供值时，这意味着该任务本身还没准备好完成，任务的`poll`函数返回`NotReady`也是。

在未来的某个时刻，资源将随时准备提供值。资源使用任务系统向执行程序发信号通知它准备。执行程序安排任务，导致`MyTask :: poll`又叫了一遍。这一次，假设`my_resource`准备就绪，那么值就是从`my_resource.poll（）返回并且任务能够完成。

## 协作调度

协作调度用于在执行程序上调度任务。单个执行人预计将通过一小组线程管理许多任务。将有比线程更多的任务。也没有先发制人。这个意味着当任务被安排执行时，它会阻止当前线程直到`poll`函数返回。

因此，只有执行`poll`的实现才是重要的在很短的时间内。对于I / O绑定应用程序，通常会发生这种情况自动。但是，如果任务必须运行更长的计算，则应该推迟工作到[阻塞池]或将计算分解为更小的块和[yield]在每个块之后返回执行程序。

[阻塞池]: https：//docs.rs/tokio-threadpool/0.1/tokio_threadpool/fn.blocking.html

## 任务系统

任务系统是资源通知执行者准备就绪的系统变化。任务由消耗资源的非阻塞逻辑组成。在里面上面的例子，`MyTask`使用单个资源`my_resource`，但没有限制任务可以使用的资源数量。

当任务正在执行并尝试使用未准备好的资源时，它在该资源上被*逻辑*阻止，即任务无法进行进一步发展，直到资源准备就绪。 Tokio跟踪哪些资源当前阻止任务以进行前进。当一个依赖资源准备就绪，执行程序安排任务。这是通过跟踪任务**在资源中表达兴趣**。

当`MyTask`执行时，尝试使用`my_resource`和`my_resource`返回`NotReady`，`MyTask`隐含表示对此感兴趣`my_resource`资源。此时，任务和资源是链接的。什么时候资源准备就绪，任务再次安排。

## `task :: current`和`Task :: notify`

通过两个API完成跟踪兴趣并通知准备情况的变化：

  * [`task :: current`] [当前]
  * [`Task :: notify`] [`notify`]

当调用`my_resource.poll（）`时，如果资源准备就绪，则立即执行不使用任务系统返回值。如果资源**不**准备好了，它通过调用[`task :: current（） - >来获取当前任务的句柄Task`] [电流]。通过读取线程局部变量集获得此句柄执行人。

一些外部事件（在网络上接收的数据，后台线程完成计算等...将导致`my_resource`准备好生成它的价值。那时，准备好`my_resource`的逻辑将调用从[`task :: current`] [`current`]获得的任务句柄上的[`notify`]。这个表示准备就绪变为执行者，执行者随后安排任务执行。

如果多个任务表示对资源感兴趣，则只有* last *任务这样做会得到通知。资源旨在从单一使用只有任务。

## `Async :: NotReady`

任何返回“Async”的函数都必须遵守[`contract`] [`contract`]。 什么时候返回`NotReady`，当前任务**必须**已经注册准备就绪变更通知。 讨论了资源的含义以上部分。 对于任务逻辑，这意味着无法返回`NotReady`除非资源已返回“NotReady”。 通过这样做，[合同] [合同]过渡地维护。 当前任务已注册通知，因为已从资源收到`NotReady`。

必须非常小心避免在没有的情况下返回“NotReady”从资源收到`NotReady`。 例如，以下任务任务结果永远不会完成。

```rust
use futures::{Future, Poll, Async};

enum BadTask {
    First(Resource1),
    Second(Resource2),
}

impl Future for BadTask {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        use BadTask::*;
        let value = match *self {
            First(ref mut resource) => {
                try_ready!(resource.poll())
            }
            Second(ref mut resource) => {
                try_ready!(resource.poll());
                return Ok(Async::Ready(()));
            }
        };

        *self = Second(Resource2::new(value));
        Ok(Async::NotReady)
    }
}
```

上面实现的问题是`Ok（Async :: NotReady）`是在将状态转换为“Second”后立即返回。 在这转换，没有资源返回`NotReady`。 当任务本身返回时“NotReady”，它违反了[合同] [合同]，因为任务不会**将来通知。

通常通过添加循环来解决这种情况：

```rust
use futures::{Future, Poll, Async};

fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
    use BadTask::*;
    loop {
        let value = match *self {
            First(ref mut resource) => {
                try_ready!(resource.poll())
            }
            Second(ref mut resource) => {
                try_ready!(resource.poll());
                return Ok(Async::Ready(()));
            }
        };

        *self = Second(Resource2::new(value));
    }
}
```

考虑它的一种方法是任务的'poll`功能**不能**返回，直到由于其资源不能进一步取得进展准备就绪或明确屈服（见下文）。

另请注意，返回“Async”的**函数只能从a调用任务**。 换句话说，这些函数只能从具有的代码中调用已经提交给`tokio :: spawn`或其他任务spawn函数。

## Yielding

有时，任务必须返回“NotReady”而不会在资源上被阻止。这通常发生在运行计算很大且任务想要的时候将控制权交还执行人以允许其执行其他 `future`。

通过通知当前任务并返回“NotReady”来完成让步：

```rust
use futures::task;
use futures::Async;

// Yield the current task. The executor will poll this task next
// iteration through its run list.
task::current().notify();
return Ok(Async::NotReady);
```

Yield可用于分解CPU昂贵的计算：

```rust
struct Count {
    remaining: usize,
}

impl Future for Count {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        while self.remaining > 0 {
            self.remaining -= 1;

            // Yield every 10 iterations
            if self.remaining % 10 == 0 {
                task::current().notify();
                return Ok(Async::NotReady);
            }
        }

        Ok(Async::Ready(()))
    }
}
```

## 执行者

执行人员负责完成许多任务。任务是产生于执行程序，执行程序调用它的`poll`函数需要的时候。执行程序挂钩到任务系统以接收资源准备通知。

通过将任务系统与执行程序实现分离，具体执行和调度逻辑可以留给执行程序实现。东京提供两个执行器实现，每个实现具有独特的 `trait`：[`current_thread`]和[`thread_pool`]。

当任务首次生成执行程序时，执行程序将其包装[[`Spawn`]] [菌种]。这将任务逻辑与任务状态绑定（这主要是遗留原因所需要的）。执行者通常会将任务存储在堆，通常是将它存储在`Box`或`Arc`中。当执行者选择一个执行任务，它调用[`Spawn :: poll_future_notify`] [`poll_future_notify`]。此函数确保将任务上下文设置为线程局部变量这样[`task :: current`] [`current`]能够读取它。

当调用[[`poll_future_notify`]] [`poll_future_notify`]时，执行者也是传递通知句柄和标识符。这些论点包含在由[`task :: current`] [`current`]返回的任务句柄，是任务的方式与遗嘱执行人有关。

notify句柄是[`notify`] [`notify`]的实现和标识符是执行程序用于查找当前任务的值。什么时候调用[`Task :: notify`] [`notify`]，[`notify`] [Notify :: notify]函数使用提供的标识符调用notify句柄。实施该函数负责执行调度逻辑。

实现执行程序的一种策略是将每个任务存储在`Box`和使用链接列表来跟踪计划执行的任务。什么时候调用[`Notify :: notify`] [Notify :: notify]，然后执行与之关联的任务标识符被推送到`scheduled`链表的末尾。当。。。的时候执行程序运行时，它从链表的前面弹出并执行任务如上所述。

请注意，本节未介绍执行程序的运行方式。细节这留给执行者实施。一个选项是执行者产生一个或多个线程并将这些线程专用于排出`scheduled`链表。另一个是提供一个阻止它的`MyExecutor :: run`函数当前线程并排出`scheduled`链表。

## 资源，驱动程序和运行时

资源是叶子 `future`，即未实施的 `future`其他 `future`。它们是使用上述任务系统的类型与执行者互动。资源类型包括TCP和UDP套接字，定时器，通道，文件句柄等.Tokio应用程序很少需要实现资源。相反，他们使用Tokio或第三方包装箱提供的资源。

通常，资源本身不能起作用并且需要驱动程序。对于例如，Tokio TCP套接字由[`Reactor`]支持。反应堆是socket资源驱动程序。单个驱动程序可以为大量资源供电实例。为了使用该资源，驱动程序必须在某处运行这个过程。 Tokio提供网络资源的驱动程序（[`tokio-reactor`]），文件资源（[`tokio-fs`]）和定时器（[`tokio-timer`]）。提供解耦驱动程序组件允许用户选择他们想要的组件使用。每个驱动程序可以单独使用或与其他驱动程序结合使用。

正因为如此，为了使用Tokio并成功执行任务，一个应用程序必须启动执行程序和资源的必要驱动程序应用程序的任务依赖于。这需要大量的样板。为了管理样板，Tokio提供了几个运行时选项。运行时
是一个执行器，捆绑了所有必要的驱动程序来为Tokio的资源提供动力。运行时不是单独管理所有各种Tokio组件在一次通话中创建并启动。

Tokio提供[并发运行时] [并发]和a[单线程] [`current_thread`]运行时。并发运行时由后备多线程，工作窃取执行程序。单线程运行时执行当前线程上的所有任务和驱动程序。用户可以选择运行时最适合应用的 `trait`。

## Future

如上所述，任务是使用[`Future`] `trait`实现的。 这个特点不仅限于实施任务。 A [`Future`]是表示a的值非阻塞计算，将在未来的某个时间完成。 任务是一个计算没有输出。 Tokio中的许多资源都用[`Future`]实现。 例如，超时是[`Future`]在达到截止日期后完成。

该 `trait`包括许多可用于工作的组合器未来价值观。

应用程序是通过实现特定于应用程序的“Future”来构建的使用组合器来定义或定义应用程序逻辑。 通常，两者兼而有之策略是最成功的。

[`goroutine`]: https://www.golang-book.com/books/intro/10#section1

[`erlang`]: http://erlang.org/doc/reference_manual/processes.html

[`Future`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html

[`Reactor`]: https://docs.rs/tokio-reactor/0.1.5/tokio_reactor/

[`tokio-reactor`]: https://docs.rs/tokio-reactor

[`tokio-fs`]: https://docs.rs/tokio-fs

[`tokio-timer`]: https://docs.rs/tokio-timer

[`concurrent`]: https://docs.rs/tokio/0.1.8/tokio/runtime/index.html

[`current_thread`]: https://docs.rs/tokio/0.1.8/tokio/runtime/current_thread/index.html

[`current_thread`]: http://docs.rs/tokio-current-thread

[`thread_pool`]: https://docs.rs/tokio-threadpool

[`Spawn`]: https://docs.rs/futures/0.1/futures/executor/struct.Spawn.html

[`poll_future_notify`]: https://docs.rs/futures/0.1/futures/executor/struct.Spawn.html#method.poll_future_notify

[`current`]: https://docs.rs/futures/0.1/futures/task/fn.current.html

[`notify`]: https://docs.rs/futures/0.1/futures/task/struct.Task.html#method.notify

[`notify`]: https://docs.rs/futures/0.1/futures/executor/trait.Notify.html

[`Notify::notify`]: https://docs.rs/futures/0.1/futures/executor/trait.Notify.html#tymethod.notify

[`contract`]: https://docs.rs/futures/0.1.23/futures/future/trait.Future.html#tymethod.poll

[`blocking pool`]: https://docs.rs/tokio-threadpool/0.1/tokio_threadpool/fn.blocking.html
