# 非阻塞I/O

本节介绍Tokio提供的网络资源和`drivers`。 这个组件提供Tokio的主要功能之一：非阻塞，事件驱动，由适当的操作系统原语提供的网络（epoll，kqueue，IOCP，...）。 它以资源和`drivers`模式为模型在上一节中描述。

网络`drivers`使用[mio]构建，网络资源由后备实现[`Evented`]的类型。

本指南将重点介绍TCP类型。 其他网络资源（UDP，unix插座，管道等）遵循相同的模式。

## 网络资源。

网络资源是类型，例如[`TcpListener`]和[`TcpStream`]由网络句柄和对正在供电的[driver]的引用组成资源。 最初，在首次创建资源时，driver指针可能是'None'：

[driver]: #the-network-driver
[`Evented`]: https://docs.rs/mio/0.6/mio/event/trait.Evented.html

```rust
let listener = TcpListener::bind(&addr).unwrap();
```

在这种情况下，尚未设置对driver的引用。 但是，如果使用带有[`Handle`]引用的构造函数，则driver引用将设置为给定句柄表示的driver：

```rust
let listener = TcpListener::from_std(std_listener, &my_reactor_handle);
```

一旦driver与资源相关联，就会将其设置为该资源的生命周期
资源，不能改变。 相关的driver负责
接收网络资源的操作系统事件并通知
对资源表示兴趣的任务。

## 使用资源

资源类型包括以`poll_`为前缀的非阻塞函数
在返回类型中包含`Async`。 这些是链接的功能
使用任务系统，应该从任务中使用，并作为一部分使用
[`Future`]实现。 例如，[`TcpStream`]提供[`poll_read`]和
[`poll_write`]。 [`TcpListener`]提供[`poll_accept`]。

这是一个使用[`poll_accept`]接受来自a的入站套接字的任务
监听器并通过生成一个新任务来处理它们：

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

资源类型还可以包括返回 `future`的函数。 这些是
使用`poll_`函数提供附加功能的助手。 对于
例如，[`TcpStream`]提供了一个返回 `future`的[`connect`]函数。
一旦[`TcpStream`]建立连接，这个 `future`就会完成
与同伴（或失败的参与者）。

使用组合器连接[`TcpStream`]：

```rust
tokio::spawn({
    let connect_future = TcpStream::connect(&addr);

    connect_future
        .and_then(|socket| process(socket))
        .map_err(|_| panic!())
});
```

`future`也可以直接用于其他`future`的实施：

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

# 使用driver注册资源

当使用[`TcpListener :: poll_accept`] [poll_accept]（或任何`poll_ *`函数）时，
如果资源已准备好立即返回，那么它将会这样做。在这种情况下
[`poll_accept`] [poll_accept]，准备就绪意味着有一个套接字
等待在队列中被接受。如果资源**不准备就绪，即
没有待接受的套接字，然后资源要求driver
一旦准备好就通知当前任务。

第一次`NotReady`由资源返回，如果资源不是
explicity使用[`Handle`]参数分配了一个driver，资源将注册
本身有一个driver实例。这是通过查看网络driver完成的
与当前执行上下文相关联。

执行上下文的默认driver使用线程局部集存储
使用[`with_default`]，并使用[`Handle :: current`]访问。它是
运行时负责确保从内部轮询任务
闭包传递给[`with_default`]。对[`Handle :: current`]的调用访问
由[`with_default`]设置的线程局部设置，以便将句柄返回给
当前执行上下文的driver。

## `Handle :: current` vs`Handle :: default`

`Handle :: current`和`Handle :: default`都返回一个`Handle`实例。
然而，它们略有不同。大多数情况下，`Handle :: default`就是
期望的行为。

`Handle :: current` **立即**读取存储的线程局部变量
当前driver的driver。这意味着必须调用`Handle :: current`
从设置默认driver的执行上下文中。 `句柄::当前`应该
当句柄将被发送到不同的执行上下文时使用
并且用户希望使用特定的反应器（参见下面的示例）。

另一方面，[`Handle :: default`]懒惰地读取线程局部变量。
这允许从执行上下文的* outside *获取`Handle`实例。
使用资源时，句柄将访问线程局部变量as
在上一节中描述。

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

在这个例子中，`incoming（）`返回一个通过调用实现的 `future`
`poll_accept`。  `future`产生于具有网络driver的运行时
配置为执行上下文的一部分。 当调用`poll_accept`时
在执行上下文中，即读取线程本地的时间
driver与`TcpListener`实例相关联。

但是，如果直接使用`tokio-threadpool`，那么任务就会产生
threadpool执行程序将无法访问reactor：

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

为了使上述示例有效，必须为此设置反应器
线程池的执行上下文。 有关更多信息，请参阅[构建运行时] [building]
细节。 或者，用`[Handle :: current]`获得的`Handle`可以是
用过的：

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

# 网络driver

为所有Tokio的网络类型提供动力的driver是[`Reactor`]类型
[`tokio-reactor`]箱子。 它是使用[mio]实现的。 打电话给
[`Reactor :: turn`]使用[`mio :: Poll :: poll`]来获取操作系统事件
注册的网络资源。 然后它通知每个注册的任务
使用[任务系统]的网络资源。 然后安排任务运行
然后，它们的关联执行程序和任务将网络资源视为就绪
并调用`poll_ *`函数返回`Async :: Ready`。

## 将driver与资源链接

driver必须跟踪向其注册的每个资源。 而实际
实现更复杂，可以认为是对a的共享引用
细胞共享状态，类似于：

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

**这不是真正的实现**，而是一个简化版本来演示
行为。 在实践中，没有“Mutex”，每个单元都没有分配
资源实例，并且reactor不使用`HashMap`。 真实的
实现可以找到[这里] [real-impl]

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

请注意，每个资源只有一个“task”字段。其含义是
资源一次只能从一个任务中使用。如果
`TcpListener :: poll_accept`返回`NotReady`，注册当前任务和
然后将监听器发送到另一个调用`poll_accept`并看到的任务
`NotReady`，然后第二个任务是唯一一个将收到一个
套接字准备好接受后通知。资源可能会支持
跟踪不同操作的不同任务。例如，`TcpStream`
内部有两个任务字段：一个用于通知read ready，另一个用于
通知写入准备好了。这允许`TcpStream :: poll_read`和
从不同的任务调用`TcpStream :: poll_write`。

对偶类型在driver的[`mio :: Poll`]实例中注册为
上面使用的`register`函数的一部分。同样，本指南使用了
**简化的**实现与实际的实现不匹配
`tokio-reactor`但足以理解`tokio-reactor`的行为方式。

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

driver需要运行才能使其相关资源正常运行。如果
driver无法运行，资源永远不会准备就绪。跑步
使用[`Runtime`]时会自动处理driver，但它很有用
了解它是如何工作的。如果你对真正的实现感兴趣，那么
[`tokio-reactor`] [real-impl]源码是最好的参考。

当资源注册到driver时，它们也会注册
Mio.运行driver在循环中执行以下步骤：

1)调用[`Poll :: poll`]来获取操作系统事件。

2)通过注册将所有事件发送到适当的资源。

[`mio :: Poll`]: https：//docs.rs/mio/0.6/mio/struct.Poll.html
[`Poll :: poll`]: https：//docs.rs/mio/0.6/mio/struct.Poll.html#method.poll

上面的步骤是通过调用`Reactor :: turn`来完成的。循环部分是最多的
我们。这通常在后台线程中完成或嵌入执行程序中
一个[`Park`]实现。有关详细信息，请参阅[运行时指南]。

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

通知任务会导致任务在其执行程序上进行调度。 什么时候
任务再次运行，它将再次调用`poll_accept`函数。 这次，
`task`插槽将是'None`。 这意味着应该尝试系统调用，并且
这次`poll_accept`将返回一个被接受的套接字（可能允许虚假事件）。

[`Runtime`]: https://docs.rs/tokio/0.1/tokio/runtime/struct.Runtime.html
[`Park`]: https://docs.rs/tokio-executor/0.1/tokio_executor/park/trait.Park.html
[real-impl]: https://github.com/tokio-rs/tokio/blob/master/tokio-reactor/src/lib.rs
[runtime guide]: https://tokio-zh.github.io/document/building-runtime.html