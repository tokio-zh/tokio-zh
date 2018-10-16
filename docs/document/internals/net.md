# 非阻塞I/O

本节介绍Tokio提供的网络资源和`drivers`。 这个组件提供Tokio的主要功能之一：非阻塞，事件驱动，由适当的操作系统原语提供的网络（epoll，kqueue，IOCP，...）。 它以资源和`drivers`模式为模型在上一节中描述。

网络`drivers`使用**mio**构建，网络资源由后备实现[`Evented`]的类型。

本指南将重点介绍TCP类型。 其他网络资源（UDP，unix插座，管道等）遵循相同的模式。

## 网络资源。

网络资源是由网络句柄和对为资源供电的[driver]的引用组成的类型，例如[`TcpListener`]和[`TcpStream`]。 最初，在首次创建资源时，driver指针可能是`None`：

[driver]: #the-network-driver
[`Evented`]: https://docs.rs/mio/0.6/mio/event/trait.Evented.html

```rust
let listener = TcpListener::bind(&addr).unwrap();
```

在这种情况下，尚未设置对driver的引用。 但是，如果使用带有[`Handle`]引用的构造函数，则driver引用将设置为给定句柄表示的driver：

```rust
let listener = TcpListener::from_std(std_listener, &my_reactor_handle);
```

一旦driver与资源相关联，就会将其设置为该资源的生命周期，不能改变。 相关的driver负责接收网络资源的操作系统事件并通知对该资源表示兴趣的任务。

## 使用资源

资源类型包括以`poll_`为前缀和在返回类型中包含`Async`的非阻塞函数。 这些函数与任务系统关联，应该从任务中使用，并作为[`Future`]实现一部分使用。 例如，[`TcpStream`]提供[`poll_read`]和[`poll_write`]。 [`TcpListener`]提供[`poll_accept`]。

这里有一个使用[`poll_accept`]]接受来自侦听器的入站套接字并通过生成新任务来处理它们的任务：

```rust
struct Acceptor {
    listener: TcpListener,
}

impl Future for Acceptor {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        loop {
            let (socket, _) = try_ready!(self.listener.poll_accept());

            // Spawn a task to process the socket
            tokio::spawn(process(socket));
        }
    }
}
```

资源类型还可以包括返回 `future`的函数。 这些是使用`poll_`函数提供附加功能的帮助程序。 例如，[`TcpStream`]提供了一个返回 `future`的[`connect`]函数。一旦[`TcpStream`]与对等方建立了连接（或未能成功），这个 `future`就会完成。

使用组合器连接[`TcpStream`]：

```rust
tokio::spawn({
    let connect_future = TcpStream::connect(&addr);

    connect_future
        .and_then(|socket| process(socket))
        .map_err(|_| panic!())
});
```

`future`也可以直接用于其他`future`的实现：

```rust
struct ConnectAndProcess {
    connect: ConnectFuture,
}

impl Future for ConnectAndProcess {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        let socket = try_ready!(self.connect.poll());
        tokio::spawn(process(socket));
        Ok(Async::Ready(()))
    }
}
```

## 使用driver注册资源

当使用[`TcpListener :: poll_accept`][poll_accept]（或任何`poll_ *`函数）时，如果资源已准备好立即返回，那么它将会这样做。在这种情况下[`poll_accept`][poll_accept]，准备就绪意味着有一个套接字在队列中等待被接受。如果资源**没有**准备就绪，即没有待接受的套接字，然后资源要求driver一旦准备好就通知当前任务。

第一次`NotReady`由资源返回，如果资源没有明确地使用[`Handle`]参数分配一个driver，则资源将使用driver实例注册自身。这是通过查看与当前执行上下文关联的网络driver来完成的。

执行上下文的默认driver使用本地线程存储，使用[`with_default`]设置，并使用[`Handle :: current`]访问。运行时负责确保，从闭包内传递到[`with_default`]过程轮询任务。调用[`Handle :: current`]访问本地线程由[`with_default`]设置，以便将句柄返回给当前执行上下文的driver。

## `Handle :: current` vs`Handle :: default`

`Handle :: current`和`Handle :: default`都返回一个`Handle`实例。
然而，它们略有不同。大多数情况下，`Handle :: default`就是
期望的行为。

`Handle :: current`为当前driver **立即**读取存储在driver中的线程局部变量。这意味着`Handle :: current`必须从设置默认driver的执行上下文中调用。 `Handle :: current`当句柄将被发送到不同的执行上下文使用并且用户希望使用特定的反应器（reactor）时使用（参见下面的示例）。

另一方面，[`Handle :: default`]懒惰地读取线程局部变量。这允许从执行上下文之外获取`Handle`实例。使用资源时，句柄将访问线程局部变量，如上一节中所述。

例如：

```rust
fn main() {
    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let std_listener = ::std::net::TcpListener::bind(&addr).unwrap();
    let listener = TcpListener::from_std(std_listener, &Handle::default()).unwrap();

    tokio::run({
        listener.incoming().for_each(|socket| {
            tokio::spawn(process(socket));
            Ok(())
        })
        .map_err(|_| panic!("error"))
    });
}
```

在这个例子中，`incoming（）`返回通过调用 `poll_accept`实现的一个 `future`。  该`future`产生于具有网络driver配置作为执行上下文的一部分的运行之上。 当在执行上下文中调用`poll_accept`时，即当读取线程本地driver与`TcpListener`实例相关联。

但是，如果直接使用`tokio-threadpool`，那么产生threadpool `executor`之上的任务就会将无法访问reactor：

```rust
let pool = ThreadPool::new();
let listener = TcpListener::bind(&addr).unwrap();

pool.spawn({
    listener.incoming().for_each(|socket| {
        // This will never get called due to the listener not being able to
        // function.
        unreachable!();
    })
    .map_err(|_| panic!("error"))
});
```

为了使上面的示例工作，必须为线程池的执行上下文设置反应器（reactor）。有关更多信息，请参阅[building a runtime][building]细节。 或者，可以使用`[Handle :: current]`获得的`Handle`：

```rust
let pool = ThreadPool::new();

// This does not run on the pool.
tokio::run(future::lazy(move || {
    // Get the handle
    let handle = Handle::current();

    let std_listener = std::net::TcpListener::bind(&addr).unwrap();

    // This eagerly links the listener with the handle for the current reactor.
    let listener = TcpListener::from_std(std_listener, &handle).unwrap();

    pool.spawn({
        listener.incoming().for_each(|socket| {
            // Do something with the socket
            Ok(())
        })
        .map_err(|_| panic!())
    });

    Ok(())
}));
```

[`TcpStream`]: https://docs.rs/tokio/0.1/tokio/net/struct.TcpStream.html
[`TcpListener`]: https://docs.rs/tokio/0.1/tokio/net/struct.TcpListener.html
[`Handle`]: https://docs.rs/tokio-reactor/0.1/tokio_reactor/struct.Handle.html
[`Handle::current`]: https://docs.rs/tokio/0.1/tokio/reactor/struct.Handle.html#method.current
[poll_accept]: http://docs.rs/tokio/0.1.8/tokio/net/struct.TcpListener.html#method.poll_accept
[`with_default`]: https://docs.rs/tokio-reactor/0.1.5/tokio_reactor/fn.with_default.html
[`Handle::default`]: https://docs.rs/tokio-reactor/0.1.5/tokio_reactor/struct.Handle.html#method.default
[building]: https://tokio.rs/docs/going-deeper/building-runtime/

## 网络driver

为所有Tokio的网络类型提供动力的driver是[`Reactor`]Crate中的[`tokio-reactor`]类型。 它是使用**mio**实现的。 调用[`Reactor :: turn`]使用[`mio :: Poll :: poll`]获取已注册网络资源的操作系统事件。 然后它使用[task system]通知每个网络资源已注册的任务。 任务被调度为在其关联的`executor`上运行，然后任务将网络资源视为就绪并且调用`poll_ *`函数返回`Async :: Ready`。

## 将driver与资源链接

driver必须跟踪向其注册的每个资源。 虽然实际实现更复杂，但可以将其视为对单元共享状态的共享引用，类似于：

```rust
struct Registration {
    // The registration needs to know its ID. This allows it to remove state
    // from the reactor when it is dropped.
    id: Id,

    // The task that owns the resource and is registered to receive readiness
    // notifications from the driver.
    //
    // If `task` is `Some`, we **definitely** know that the resource
    // is not ready because we have not yet received an operating system event.
    // This allows avoiding syscalls that will return `NotReady`.
    //
    // If `task` is `None`, then the resource **might** be ready. We can try the
    // syscall, but it might still return `NotReady`.
    task: Option<task::Task>,
}

struct TcpListener {
    mio_listener: mio::TcpListener,
    registration: Option<Arc<Mutex<Registration>>>,
}

struct Reactor {
    poll: mio::Poll,
    resources: HashMap<Id, Arc<Mutex<Registration>>>,
}
```

**这不是真正的实现**，而是用于演示行为的简化版本。在实践中，没有`Mutex`，每个资源实例没有分配单元，并且reactor不使用`HashMap`。 真正的实现在[here][real-impl]

首次使用资源时，它会向driver注册：

```rust
impl TcpListener {
    fn poll_accept(&mut self) -> Poll<TcpStream, io::Error> {
        // If the registration is not set, this will associate the `TcpListener`
        // with the current execution context's reactor.
        let registration = self.registration.get_or_insert_with(|| {
            // Access the thread-local variable that tracks the reactor.
            Reactor::with_current(|reactor| {
                // Registers the listener, which implements `mio::Evented`.
                // `register` returns the registration instance for the resource.
                reactor.register(&self.mio_listener)
            })
        });

        if registration.task.is_none() {
            // The task is `None`, this means the resource **might** be ready.
            match self.mio_listener.accept() {
                Ok(socket) => {
                    let socket = mio_socket_to_tokio(socket);
                    return Ok(Async::Ready(socket));
                }
                Err(ref e) if e.kind() == WouldBlock => {
                    // The resource is not ready, fall through to task registration
                }
                Err(e) => {
                    // All other errors are returned to the caller
                    return Err(e);
                }
            }
        }

        // The task is set even if it is already `Some`, this handles the case where
        // the resource is moved to a different task than the one stored in
        // `self.task`.
        registration.task = Some(task::current());
        Ok(Async::NotReady)
    }
}
```

请注意，每个资源只有一个`task`字段。其含义是资源一次只能从一个任务中使用。如果`TcpListener :: poll_accept`返回`NotReady`，注册当前任务和将监听器发送到另一个调用`poll_accept`的任务并视为`NotReady`，然后第二个任务是唯一一个在套接字准备好被接受后将接收通知的任务。资源可能会支持跟踪不同操作的不同任务。例如，`TcpStream`内部有两个任务字段：一个用于通知`read`准备好了，另一个用于通知`write`准备好了。这允许从不同的任务调用`TcpStream :: poll_read`和`TcpStream :: poll_write`。

[`mio :: Poll`]作为`register`上面使用的函数的一部分，将事件类型注册到驱动程序的实例中。。同样，本指南使用了**简化的**实现与实际`tokio-reactor`的实现不匹配,但足以理解`tokio-reactor`的行为方式。

```rust
impl Reactor {
    fn register<T: mio::Evented>(&mut self, evented: &T) -> Arc<Mutex<Registration>> {
        // Generate a unique identifier for this registration. This identifier
        // can be converted to and from a Mio Token.
        let id = generate_unique_identifier();

        // Register the I/O type with Mio
        self.poll.register(
            evented, id.into_token(),
            mio::Ready::all(),
            mio::PollOpt::edge());

        let registration = Arc::new(Mutex::new(Registration {
            id,
            task: None,
        }));

        self.resources.insert(id, registration.clone());

        registration
    }
}
```

## 运行driver

driver需要运行才能使其相关资源正常工作。如果driver无法运行，资源永远不会准备就绪。使用[`Runtime`]时会自动处理运行driver，但了解它是如何工作的很有用。如果你对真正的实现感兴趣，那么[`tokio-reactor`] [real-impl]源码是最好的参考。

当资源注册到driver时，它们也会注册Mio，运行driver在循环中执行以下步骤：

1)调用[`Poll :: poll`]来获取操作系统事件。

2)发送所有事件到适当的注册过的资源。

[`mio::Poll`]: https://docs.rs/mio/0.6/mio/struct.Poll.html
[`Poll::poll`]: https://docs.rs/mio/0.6/mio/struct.Poll.html#method.poll

上面的步骤是通过调用`Reactor :: turn`来完成的。循环部分是取决于我们。这通常在后台线程中完成或嵌入`executor`中作为一个[`Park`]实现。有关详细信息，请参阅[runtime guide]。

```rust
loop {
    // `None` means never timeout, blocking until we receive an operating system
    // event.
    reactor.turn(None);
}
```

`turn`的实现执行以下操作：

```rust
fn turn(&mut self) {
    // Create storage for operating system events. This shouldn't be created
    // each time `turn` is called, but doing so does not impact behavior.
    let mut events = mio::Events::with_capacity(1024);

    self.poll.poll(&mut events, timeout);

    for event in &events {
        let id = Id::from_token(event.token());

        if let Some(registration) = self.resources.get(&id) {
            if let Some(task) = registration.lock().unwrap().task.take() {
                task.notify();
            }
        }
    }
}
```

任务在其executor上进行调度会通知任务会结果。 当任务再次运行，它将再次调用`poll_accept`函数。 这次，`task`插槽将是`None`。 这意味着应该尝试系统调用，并且这次`poll_accept`将返回一个被接受的套接字（可能允许虚假事件）。

[`Runtime`]: https://docs.rs/tokio/0.1/tokio/runtime/struct.Runtime.html
[`Park`]: https://docs.rs/tokio-executor/0.1/tokio_executor/park/trait.Park.html
[real-impl]: https://github.com/tokio-rs/tokio/blob/master/tokio-reactor/src/lib.rs
[runtime guide]: https://tokio-zh.github.io/document/building-runtime.html
