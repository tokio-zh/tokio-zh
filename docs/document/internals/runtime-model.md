# 运行时模型

使用Tokio编写的应用程序组织在大量小的非阻塞任务中。 Tokio任务类似于[goroutine](https://www.golang-book.com/books/intro/10#section1)或者[Erlang进程](http：//erlang.org/doc/reference_manual/processes.html)，但是是非阻塞的。它们设计为轻量级，可以快速生成，并保持较低的调度开销。它们也是非阻塞的，因为无法立即完成的此类操作必须立即返回。它们返回一个表示操作正在进行的值，而不是返回操作的结果,表明操作正在进行中。

## 非阻塞执行

使用[Future] trait实现Tokio任务：

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

使用`tokio :: spawn`或通过调用`executor`对象上的[Spawn]方法将任务提交给 `executor`。 `poll`函数驱动任务。没有调用`poll`就什么都不做。在任务上调用`poll`直到`Ready（（））`返回是 `executor`的工作。

`MyTask`将从`my_resource`接收一个值并处理它。一旦值处理完毕，任务就完成了他的逻辑并结束。这会返回`Ok（Async :: Ready（（）））`。

为了完成处理，任务取决于`my_resource`提供的值。鉴于`my_resource`是一个非阻塞任务，它在调用`my_resource.poll（）`时，可能准备好或者还没准备好提供值。如果它准备就绪，它返回`Ok（Async :: Ready（value））`。如果没有准备好，它会返回`Ok(Async::NotReady)`。

当资源未准备好提供值时，这意味着该任务本身还没准备好完成，任务的`poll`函数也返回`NotReady`。

在未来的某个时刻，资源将随时准备提供值。资源使用任务系统向 `executor`发信号给`executor`通知它已准备好。 `executor`安排任务，导致`MyTask :: poll`又叫了一遍。这一次，假设`my_resource`准备就绪，那么值就是从`my_resource.poll（）`返回并且任务完成。

## 协作调度

协作调度用于在 `executor`上调度任务。单个 `executor`将通过一小组线程管理许多任务。将有比线程更多的任务。这也没有抢占。这个意味着当任务被安排执行时，它会阻止当前线程直到`poll`函数返回。

因此，实现`poll`在很短的时间内执行才是重要的。对于I / O绑定的应用程序，通常会发生这种情况。但是，如果任务预计必须长时间运行，则应该推迟工作到[blocking pool]或将计算分解为更小的块和在每个块执行之后[yield]回来。

[blocking pool]: https：//docs.rs/tokio-threadpool/0.1/tokio_threadpool/fn.blocking.html

## 任务系统

任务系统是资源通知`executor`准备就绪的系统。 任务由消耗资源的非阻塞逻辑组成。 在上面的示例中，`MyTask`使用单个资源`my_resource`，但没有限制任务可以使用的资源数量。

当任务正在执行并尝试使用未准备好的资源时，它在该资源上被*逻辑*阻塞，即任务无法进一步处理，直到资源准备就绪。 Tokio跟踪阻塞当前任务的资源以进行推进。当一个依赖资源准备就绪， `executor`安排任务。这是通过跟踪**当任务在资源中表现兴趣**完成。

当`MyTask`执行，尝试使用`my_resource`和`my_resource`返回`NotReady`时，`MyTask`隐含表示对`my_resource`资源感兴趣。对此，任务和资源是连接的。什么时候资源准备就绪，任务再次被安排。

## `task :: current`和`Task :: notify`

通过两个API完成跟踪兴趣并通知准备情况的变化：

* [`task::current`][current]
* [`Task::notify`][notify]

当调用`my_resource.poll（）`时，如果资源准备就绪，则立即返回值而不使用任务系统。如果资源**没有**准备好，通过调用[`task::current() -> Task`][current] 来获取当前任务的句柄。这是通过读取`executor`设置的线程局部变量集获得此句柄 。

一些外部事件（在网络上接收的数据，后台线程完成计算等...将导致`my_resource`准备好生成它的值。那时，准备好`my_resource`的逻辑将调用从[`task :: current`] [current]获得的任务句柄上的[`notify`]。这个表示准备就绪会改变 `executor`， `executor`随后安排任务执行。

如果多个任务表示对资源感兴趣，则只有**last**任务这样做会得到通知。资源旨在从单一任务使用。

## `Async :: NotReady`

任何返回`Async`的函数都必须遵守[contract][contract](契约)。 当返回`NotReady`，当前任务**必须**已经注册准备就绪变更通知。 以上部分讨论了资源的含义。 对于任务逻辑，这意味着无法返回`NotReady`除非资源已返回“NotReady”。 通过这样做，[contract][contract]得到了传承。 当前任务已注册通知，因为已从资源收到`NotReady`。

必须非常小心避免在没有从资源收到`NotReady`的情况下返回`NotReady`。 例如，以下任务中，任务实现结果永远不会完成。

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

上面实现的问题是`Ok（Async :: NotReady）`是在将状态转换为`Second`后立即返回。 在这转换中，没有资源返回`NotReady`。 当任务本身返回时`NotReady`，它违反了[contract][contract] ，因为任务将来不会被通知。

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

思考它的一种方法是任务的`poll`函数**不能**返回，直到由于其资源不能进一步取得进展而准备就绪或明确`yields`（见下文）。

另请注意，返回`Async`的**函数只能从一个任务调用**。 换句话说，这些函数只能从已经提交给`tokio :: spawn`或其他任务spawn函数调用

## Yielding

有时，任务必须返回`NotReady`而不是在资源上被阻塞。这通常发生在运行计算很大且任务想要的时候将控制权交还 `executor`以允许其执行其他 `future`。

Yielding 是通过通知当前任务并返回“NotReady”完成：

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

##  `executor`

 `executor`员负责驱动完成许多任务。任务是产生于 `executor`之上， 是在`executor`需要调用它的`poll`函数的时候。 `executor`挂钩到任务系统以接收资源准备通知。

通过将任务系统与 `executor`实现分离，具体执行和调度逻辑可以留给 `executor`实现。`tokio`提供两个`executor`实现，每个实现具有独特的特点：[`current_thread`]和[`thread_pool`]。

当任务首次在`executor`之上生成时， `executor`用[`Spawn`][Spawn]将其包装。这将任务逻辑与任务状态绑定（这主要是遗留原因所需要的）。 `executor`通常会将任务存储在堆，通常是将它存储在`Box`或`Arc`中。当 `executor`选择一个执行任务，它调用[`Spawn :: poll_future_notify`][poll_future_notify]。此函数确保将任务上下文设置为线程局部变量像[`task :: current`][current]能够读取它。

当调用[`poll_future_notify`][poll_future_notify]时， `executor`也是传递通知句柄和标识符。这些参数包含在由[`task :: current`][current]返回的任务句柄中，也是有关任务与`executor`连接的方式。

notify句柄是[`Notify`][`Notify`] 的实现，标识符是 `executor`用于查找当前任务的值。当调用[`Task :: notify`][notify]，[`notify`][Notify :: notify]函数使用提供的标识符调用notify句柄。该函数的实现负责执行调度逻辑。

实现 `executor`的一种策略是将每个任务存储在`Box`和使用链接列表来跟踪计划执行的任务。当调用[`Notify :: notify`][Notify :: notify]，然后将与之关联的任务标识符被推送到`scheduled`链表的末尾。当 `executor`运行时，它从链表的前端弹出并执行任务如上所述。

请注意，本节未介绍 `executor`的运行方式。细节这留给 `executor`实现。一个选项是 `executor`产生一个或多个线程并将这些线程专用于排出`scheduled`链表。另一个是提供一个`MyExecutor :: run`函数阻塞当前线程并排出`scheduled`链表。

## 资源，drivers和运行时

资源是叶子 `future`，即未实施的 `future`其他 `future`。它们是使用上述任务系统的类型与 `executor`互动。资源类型包括TCP和UDP套接字，定时器，通道，文件句柄等.Tokio应用程序很少需要实现资源。相反，他们使用Tokio或第三方包装箱提供的资源。

通常，资源本身不能起作用而是需要drivers。例如，Tokio TCP套接字由[`Reactor`]支持。`Reactor`是socket资源driver。单个driver可以为大量资源实例提供动力。要使用该资源，drivers必须在某处运行这个过程。 Tokio提供网络资源的drivers（[`tokio-reactor`]），文件资源（[`tokio-fs`]）和定时器（[`tokio-timer`]）。提供解耦driver组件允许用户选择他们想要使用的组件。每个driver可以单独使用或与其他driver结合使用。

正因为如此，为了使用Tokio并成功执行任务，一个应用程序必须启动 `executor`和必要的drivers作为应用程序的任务依赖的资源。这需要大量的样板。为了管理样板，Tokio提供了几个运行时选项。运行时是与所有必需drivers捆绑在一起的`executor`，以便为Tokio的资源提供动力。不是单独管理所有各种Tokio组件，而是在一次调用中创建并启动运行时。

Tokio提供[并发运行时][concurrent]和[单线程][current_thread]运行时。并发运行时基于多线程、工作窃取 `executor`。单线程运行时执行当前线程上的所有任务和drivers。用户可以选择最适合应用的运行时。

## Future

如上所述，任务是使用[Future] `trait`实现的。 这个特点不仅限于实施任务。 一个 [Future]是表示一个非阻塞计算的值在未来的某个时间完成。 任务是一个计算没有输出。 Tokio中的许多资源都用[Future]实现。 例如，超时是[Future]在达到截止日期后完成。

该 `trait`包括许多与Future值一起工作的有用的组合器。

通过对应用特定类型实现`Future`来构建应用或使用组合器来定义应用程序逻辑。 通常两者兼而有之策略是最成功的。

[Future]: https://docs.rs/futures/0.1/futures/future/trait.Future.html

[yield]: https://tokio.rs/docs/internals/runtime-model/#yielding

[`Reactor`]: https://docs.rs/tokio-reactor/0.1.5/tokio_reactor/

[`tokio-reactor`]: https://docs.rs/tokio-reactor

[`tokio-fs`]: https://docs.rs/tokio-fs

[`tokio-timer`]: https://docs.rs/tokio-timer

[concurrent]: https://docs.rs/tokio/0.1.8/tokio/runtime/index.html

[current_thread]: https://docs.rs/tokio/0.1.8/tokio/runtime/current_thread/index.html

[`current_thread`]: http://docs.rs/tokio-current-thread

[`thread_pool`]: https://docs.rs/tokio-threadpool

[Spawn]: https://docs.rs/futures/0.1/futures/executor/struct.Spawn.html

[poll_future_notify]: https://docs.rs/futures/0.1/futures/executor/struct.Spawn.html#method.poll_future_notify

[current]: https://docs.rs/futures/0.1/futures/task/fn.current.html

[notify]: https://docs.rs/futures/0.1/futures/task/struct.Task.html#method.notify

[`Notify`]: https://docs.rs/futures/0.1/futures/executor/trait.Notify.html

[Notify::notify]: https://docs.rs/futures/0.1/futures/executor/trait.Notify.html#tymethod.notify

[contract]: https://docs.rs/futures/0.1.23/futures/future/trait.Future.html#tymethod.poll

[`blocking pool`]: https://docs.rs/tokio-threadpool/0.1/tokio_threadpool/fn.blocking.html
