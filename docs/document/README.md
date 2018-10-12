# 概括

Tokio是一个允许开发者在rust编程语言中编写异步程序库．在程序进行长时间的运行操作（各种I/O操作，比如读文件）时，他允许程序继续执行接下来的代码，而不是同步等待长时间运行的操作．

进一步说，Tokio是一个事件驱动的非阻塞I/O平台，用于使用Rust编程语言编写异步应用程序。在较高的层面上，它提供了一些主要组件：

* 基于多线程，工作窃取的任务调度程序。
* 由操作系统的事件队列（epoll，kqueue，IOCP等）支持的反应器。
* 异步TCP和UDP套接字。

这些组件提供构建异步应用程序所需的运行时组件。

## 快速

Tokio是基于Rust编程语言构建的，它本身非常快。使用Tokio构建的应用程序将获得同样的好处。 Tokio的设计也旨在使应用程序尽可能快。

#### 零成本抽象

Tokio以[futures](https://tokio.rs/docs/getting-started/futures/)基础。Futures不是一个新的想法，但Tokio使用它们的方式是独一无二的。与其他语言的futures不同，Tokio的futures编译成状态机。用futures实现的同步，分配或者其他的成本并没有增加程序的开销．

请注意，提供零成本抽象并不意味着Tokio本身没有成本。这意味着使用Tokio导致最终产品具有与不使用Tokio相同的开销。

#### 并发

开箱即用，Tokio提供了一个多线程，工作窃取的调度程序。因此，当您使用　tokio::run　开始使用应用程序时，您已经在使用所有计算机的CPU核心。

现代计算机通过添加核心来提高其性能，因此能够利用多个核心对于编写快速应用程序至关重要。

#### 非阻塞I/O

当访问网络时，Tokio将使用操作系统可用的最有效的I/O事件通知机制。在Linux上，这是[epoll](http://man7.org/linux/man-pages/man7/epoll.7.html)，*bsd平台使用[kqueue](https://www.freebsd.org/cgi/man.cgi?query=kqueue&sektion=2)，Windows使用的是[I/O completion ports](https://docs.microsoft.com/en-us/windows/desktop/fileio/i-o-completion-ports)。

这允许在单个线程上多路复用许多套接字和批量接收操作系统通知，从而减少系统调用成为可能。所有这些都可以减少应用程序的开销。

### 可靠性

虽然Tokio无法阻止所有错误，但它的目的是最小化它们。它通过提供难以滥用的API来实现这一点。在一天结束时，您可以放心地将应用程序投入到生产环境中使用。

#### 所有权和类型系统

Rust的所有权模型和类型系统可以实现系统级应用程序，而不必担心内存不安全。它可以防止典型的错误，例如访问未初始化的内存和使用后释放内存。它在不添加任何运行时开销的情况下执行此操作。

此外，API能够利用类型系统来提供难以滥用的API。例如，Mutex不要求用户明确解锁：

```rust
use std::sync::Mutex;

# let foo = "".to_string();
let data = Mutex::new(foo);

let locked = data.lock().unwrap();
println!("locked data: {}", &locked[..]);

// The lock is automatically released here when `locked` goes out of scope.
```

#### 背压

在基于推送的系统中，当生产者生成的数据快于消费者可以处理的数据时，数据将开始备份。待处理数据存储在内存中。除非生产者停止生产，否则系统最终会耗尽内存并崩溃。消费者通知生产者减速的能力是背压。

因为Tokio使用基于轮询的模型，所以问题大多消失了。生产者默认是懒惰的。除非消费者要求，否则他们不会产生任何数据。这是Tokio的基础。

#### 消除

由于Tokio基于轮询的模型，除非对它们进行轮询，否则计算不起作用。该计算的依赖性持有表示该计算结果的futures。如果不再需要结果，则会删除futures。此时，将不再轮询计算，因此不再执行任何工作。

由于Rust的所有权模型，计算能够实现drop handle以检测未来的droped。这允许它执行任何必要的清理工作。

## 轻量级

Tokio的扩展性很好，不需要增加应用程序的额外开销，就可以使其能够在资源受限的环境中茁壮成长。

#### 没有垃圾收集
因为Tokio是基于Rust构建的，所以编译后的可执行文件包含最少的语言运行时。最终产品类似于C ++将生成的产品。这意味着，没有垃圾收集器，没有虚拟机，没有JIT编译，也没有堆栈操作。专心编写您的服务器应用程序，而不必担心停止[stop-the-world](https://en.wikipedia.org/wiki/Garbage_collection_(computer_science)#Disadvantages)。

可以使用Tokio而不会产生任何运行时分配，使其非常适合实时用例。

#### 模块化

虽然Tokio提供了很多开箱即用的功能，但它的组织非常模块化。每个组件都位于一个单独的库中。如果需要，应用程序可以选择挑选所需的组件，避免下载其余组件。

例子:带有Tokio的基本TCP echo服务器：

```rust
extern crate tokio;

use tokio::prelude::*;
use tokio::io::copy;
use tokio::net::TcpListener;

fn main() {
    // Bind the server's socket.
    let addr = "127.0.0.1:12345".parse().unwrap();
    let listener = TcpListener::bind(&addr)
        .expect("unable to bind TCP listener");

    // Pull out a stream of sockets for incoming connections
    let server = listener.incoming()
        .map_err(|e| eprintln!("accept failed = {:?}", e))
        .for_each(|sock| {
            // Split up the reading and writing parts of the
            // socket.
            let (reader, writer) = sock.split();

            // A future that echos the data and returns how
            // many bytes were copied...
            let bytes_copied = copy(reader, writer);

            // ... after which we'll print what happened.
            let handle_conn = bytes_copied.map(|amt| {
                println!("wrote {:?} bytes", amt)
            }).map_err(|err| {
                eprintln!("IO error {:?}", err)
            });

            // Spawn the future as a concurrent task.
            tokio::spawn(handle_conn)
        });

    // Start the Tokio runtime
    tokio::run(server);
}
```