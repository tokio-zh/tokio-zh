# 创建任务

基于 Tokio 的应用程序是以任务（task）为单位组织的。任务是较小的独立运行的逻辑单元。类似于 [Go 语言的 goroutine][Go's goroutine] 和 [Erlang 的 process][Erlang's process]。换句话说，任务是异步的绿色线程（green thread）。创建（spawn）任务与使用同步代码创建线程往往出于相似的原因，但是使用 Tokio 创建任务非常轻量。

之前的一些例子定义 future 并将其传递给 `tokio::run` 函数。这样就会在 Tokio 的运行时上创建一个任务并执行。更多的任务可能需要通过调用 `tokio::spawn` 来创建，这仅限于那些已经作为 Tokio 任务运行的代码。有一个帮助理解的好方法，我们可以把传递给 `tokio::run` 函数的 future 视为 “main 函数”。

下面的例子创建了四个任务.

```rust
extern crate tokio;
extern crate futures;

use futures::future::lazy;

tokio::run(lazy(|| {
    for i in 0..4 {
        tokio::spawn(lazy(move || {
            println!("Hello from task {}", i);
            Ok(())
        }));
    }

    Ok(())
}));
```

`tokio::run` 函数将会一直阻塞，直到传递给它的 future 包括其他所有创建的任务执行完。而在这个例子中，`tokio::run`将会阻塞至四个任务将内容打印到标准输出（stdout）然后退出。

[`lazy`] 函数会在 future 第一次被拉取时运行内部的闭包。这里使用它是为了确保 `tokio::spawn` 是从一个任务中调用的。如果不使用 [`lazy`]，`tokio::spawn` 就会在任务上下文的外部调用，这样就会产生错误了。

## 与任务通信

就像 Go 语言和 Erlang 那样，任务可以通过传递消息来通信。实际上，使用消息传递来协调任务是非常常见的。相互独立的任务因此可以产生互动。

[`futures`] 库提供了一个 [`sync`] 模块，这个模块包括了一些通道（channel）类型，它们是跨任务消息传递的理想选择。

* [`oneshot`] 是用于发送单个值的通道。
* [`mpsc`] 是用于发送多个值（零或多个）的通道。

`oneshot` 非常适用于从一个已创建的任务中获取结果：

```rust
extern crate tokio;
extern crate futures;

use futures::Future;
use futures::future::lazy;
use futures::sync::oneshot;

tokio::run(lazy(|| {
    let (tx, rx) = oneshot::channel();

    tokio::spawn(lazy(|| {
        tx.send("hello from spawned task");
        Ok(())
    }));

    rx.and_then(|msg| {
        println!("Got `{}`", msg);
        Ok(())
    })
    .map_err(|e| println!("error = {:?}", e))
}));
```

而 `mpsc` 适用于将流式数据发送到另一个任务中：

```rust
extern crate tokio;
extern crate futures;

use futures::{stream, Future, Stream, Sink};
use futures::future::lazy;
use futures::sync::mpsc;

tokio::run(lazy(|| {
    let (tx, rx) = mpsc::channel(1_024);

    tokio::spawn({
        stream::iter_ok(0..10).fold(tx, |tx, i| {
            tx.send(format!("Message {} from spawned task", i))
                .map_err(|e| println!("error = {:?}", e))
        })
        .map(|_| ()) // 释放 tx 句柄
    });

    rx.for_each(|msg| {
        println!("Got `{}`", msg);
        Ok(())
    })
}));
```

以上两个消息传递原语也将用于后续例子中任务间的协调与通信。

## 多线程

使用 future 而不创建任务来实现并发也是可以的，这种并发将运行于单线程中。而创建任务则允许 Tokio 运行时在多个线程上调度这些任务。

[多线程 Tokio 运行时][rt] 在内部管理多个操作系统线程。它可以仅靠少量物理线程多路复用来运行很多任务。当一个 Tokio 应用创建任务时，这些任务会被提交给运行时环境，运行时环境将自动调度。

[rt]: https://docs.rs/tokio/0.1/tokio/runtime/index.html

## 何时创建任务

对于大多数软件相关的问题，我们的答案都是要视具体情况来决定。通常来说，你应该尽可能的创建任务。因为你创建的任务越多，就意味着你并行地执行任务的能力就越强。但是，一定要注意，多任务通信会引入通道的开销。

接下来的几个例子将介绍如何创建新任务。

### 处理入站套接字

创建任务最直接的例子就是网络服务器。它的主任务（main task）是用TCP监听器监听入站套接字。当一个新的连接建立时，监听器任务将创建一个新任务来处理对应的套接字。

```rust
extern crate tokio;
extern crate futures;

use tokio::io;
use tokio::net::TcpListener;
use futures::{Future, Stream};

let addr = "127.0.0.1:0".parse().unwrap();
let listener = TcpListener::bind(&addr).unwrap();

tokio::run({
    listener.incoming().for_each(|socket| {
        // 接受到一个入站套接字
        //
        // 创建一个新任务来处理套接字
        tokio::spawn({
            // 在本例中，直接将 "hello world" 写入到套接字中然后关闭
            io::write_all(socket, "hello world")
                // 释放套接字
                .map(|_| ())
                // 向标准输出（stdout）中写入错误信息
                .map_err(|e| println!("socket error = {:?}", e))
        });

        // 接受下一个入站套接字
        Ok(())
    })
    .map_err(|e| println!("listener error = {:?}", e))
});
```
监听任务以及每个套接字的处理任务是完全无关的。它们不需要通信，运行停止也不会影响其它任务。以上，就是一个创建任务的完美用例。

### 后台处理

另一个例子是创建任务用于执行后台计算来为其它任务提供服务。它的主任务发送数据至后台任务处理，但并不关心数据是否或何时被处理。这样就可以实现一个单独的后台任务对来自多个主任务的数据进行合并处理。 

这个例子需要主任务与后台任务通信。通常用 [`mpsc`] 通道来处理。

下面的例子是一个TCP服务器，它从远端读取数据，并记录接受的字节数。然后，它把接受的字节数发送到一个后台任务。这个后台任务将每30秒打印各套接字任务接受的字节数总和。

```rust
extern crate tokio;
extern crate futures;

use tokio::io;
use tokio::net::TcpListener;
use tokio::timer::Interval;
use futures::{future, stream, Future, Stream, Sink};
use futures::future::lazy;
use futures::sync::mpsc;
use std::time::Duration;


// 定义后台任务。`rx` 参数是通道的接收句柄。
// 任务将从通道中拉取 `usize` 值（代表套接字读取都字节数）并求总和。
// 所求的总和将每三十秒被打印到标准输出（stdout）然后重置为零。
fn bg_task(rx: mpsc::Receiver<usize>)
-> impl Future<Item = (), Error = ()>
{
    // The stream of received `usize` values will be merged with a 30
    // second interval stream. The value types of each stream must
    // match. This enum is used to track the various values.
    #[derive(Eq, PartialEq)]
    enum Item {
        Value(usize),
        Tick,
        Done,
    }

    // 打印总和到标准输出都时间间隔。
    let tick_dur = Duration::from_secs(30);

    let interval = Interval::new_interval(tick_dur)
        .map(|_| Item::Tick)
        .map_err(|_| ());

    // 将流转换为这样的序列:
    // Item(num), Item(num), ... Done
    //
    let items = rx.map(Item::Value)
      .chain(stream::once(Ok(Item::Done)))
      // Merge in the stream of intervals
      .select(interval)
      // Terminate the stream once `Done` is received. This is necessary
      // because `Interval` is an infinite stream and `select` will keep
      // selecting on it.
      .take_while(|item| future::ok(*item != Item::Done));

    // With the stream of `Item` values, start our logic.
    //
    // Using `fold` allows the state to be maintained across iterations.
    // In this case, the state is the number of read bytes between tick.
    items.fold(0, |num, item| {
        match item {
            // Sum the number of bytes with the state.
            Item::Value(v) => future::ok(num + v),
            Item::Tick => {
                println!("bytes read = {}", num);

                // 重置字节计数器
                future::ok(0)
            }
            _ => unreachable!(),
        }
    })
    .map(|_| ())
}

// 启动应用
tokio::run(lazy(|| {
    let addr = "127.0.0.1:0".parse().unwrap();
    let listener = TcpListener::bind(&addr).unwrap();

    // 创建用于与后台任务通信的通道。
    let (tx, rx) = mpsc::channel(1_024);

    // 创建后台任务：
    tokio::spawn(bg_task(rx));

    listener.incoming().for_each(move |socket| {
        // 接收到一个入站套接字。
        //
        // 创建新任务处理套接字。
        tokio::spawn({
            // 每个新创建的任务都会拥有发送者句柄的一份拷贝。
            let tx = tx.clone();

            // 在本例中，将 "hello world" 写入套接字然后关闭之。
            io::read_to_end(socket, vec![])
                // 释放套接字
                .and_then(move |(_, buf)| {
                    tx.send(buf.len())
                        .map_err(|_| io::ErrorKind::Other.into())
                })
                .map(|_| ())
                // 打印错误信息到标准输出
                .map_err(|e| println!("socket error = {:?}", e))
        });

        // 接收下一个入站套接字
        Ok(())
    })
    .map_err(|e| println!("listener error = {:?}", e))
}));
```

### 协调资源访问

在使用 future 时，协调资源（套接字、数据等等）访问的一个较好的策略时使用消息传递。要实现这样的策略，就需要创建一个专用的任务管理资源，而其它的任务通过发送消息与这个资源交互。

这种模式与之前的例子非常相似，但是这次，任务需要在操作完成后接受一个返回消息。要实现这种模式，`mpsc` 和 `oneshot` 两种通道都会用到。

这个例子通过 “乒乓协议（ping/pong protocol）” 协调对一个 [transport] 的访问。“乒” 是发送到 transport 上的，而 “乓” 是在上面接收到的。主任务（primary task）发送一个消息到协调者任务（coordinator task）来初始化一个 “乒” 的请求，协调者任务会将消息往返时间作为请求的响应。主任务通过 `mpsc` 发送给协调者任务的消息包含一个  `oneshot::Sender` 值，协调者任务可以通过它返回响应。 

```rust
extern crate tokio;
extern crate futures;

use tokio::io;
use futures::{future, Future, Stream, Sink};
use futures::future::lazy;
use futures::sync::{mpsc, oneshot};
use std::time::{Duration, Instant};

type Message = oneshot::Sender<Duration>;

struct Transport;

impl Transport {
    fn send_ping(&self) {
        // ...
    }

    fn recv_pong(&self) -> impl Future<Item = (), Error = io::Error> {
        // ...
    }
}

fn coordinator_task(rx: mpsc::Receiver<Message>)
-> impl Future<Item = (), Error = ()>
{
    let transport = Transport;

    rx.for_each(move |pong_tx| {
        let start = Instant::now();

        transport.send_ping();

        transport.recv_pong()
            .map_err(|_| ())
            .and_then(move |_| {
                let rtt = start.elapsed();
                pong_tx.send(rtt).unwrap();
                Ok(())
            })
    })
}

/// Request an rtt.
fn rtt(tx: mpsc::Sender<Message>)
-> impl Future<Item = (Duration, mpsc::Sender<Message>), Error = ()>
{
    let (resp_tx, resp_rx) = oneshot::channel();

    tx.send(resp_tx)
        .map_err(|_| ())
        .and_then(|tx| {
            resp_rx.map(|dur| (dur, tx))
                .map_err(|_| ())
        })
}

// 启动应用
tokio::run(lazy(|| {
    // 创建用于与后台任务通信的通道.
    let (tx, rx) = mpsc::channel(1_024);

    // 创建后台任务：
    tokio::spawn(coordinator_task(rx));

    // 创建少量任务，它们向协调者任务请求 RTT 时间。
    for _ in 0..4 {
        let tx = tx.clone();

        tokio::spawn(lazy(|| {
            rtt(tx).and_then(|(dur, _)| {
                println!("duration = {:?}", dur);
                Ok(())
            })
        }));
    }

    Ok(())
}));
```

## 何时不要创建任务

如果通过消息传递进行协调以及同步原语带来的开销已经超过了创建任务带来的并行收益，那么使用一个单独的任务会是更好的选择。

比如，通常来讲，对同一个 TCP 套接字而言，在一个的任务中进行读写要好过把读和写分到两个任务中进行。

[Go's goroutine]: https://www.golang-book.com/books/intro/10
[Erlang's process]: http://erlang.org/doc/reference_manual/processes.html
[`lazy`]: https://docs.rs/futures/0.1/futures/future/fn.lazy.html
[rtt]: https://en.wikipedia.org/wiki/Round-trip_delay_time
