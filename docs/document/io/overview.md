# I/O概叙

Rust标准库提供对网络和I/O的支持，例如TCP连接，UDP套接字，读取和写入文件等。但是，这些操作都是同步或*阻塞*的，这意味着当它们被调用时，当前线程可能会停止执行并进入睡眠状态，直到它被解除阻塞。例如，[std::io::Read](https://doc.rust-lang.org/std/io/trait.Read.html)中的`read`方法会阻塞当前线程，直到能读取到数据。在使用Future的时候，这种行为会有问题，因为我们希望在等待I/O完成时继续执行我们可能拥有的其他Future。

为了实现这一点，Tokio提供了许多标准库I/O资源的非阻塞版本，例如[文件操作](https://docs.rs/tokio/0.1/tokio/fs/index.html)和[TCP](https://docs.rs/tokio/0.1/tokio/net/tcp/index.html)，[UDP](https://docs.rs/tokio/0.1/tokio/net/udp/index.html)和 [Unix](https://docs.rs/tokio/0.1/tokio/net/unix/index.html)套接字。这些操作为长时间运行的操作（如接受新的TCP连接）返回Future，并实现无阻塞 `std::io::Read`和`std::io::Write`的async版本，名为`AsyncRead`和 `AsyncWrite`。

例如，如果没有可用的数据，非阻塞读写不会阻塞当前线程。相反，它们会立即返回 `WouldBlock`错误，同时保证（`Future::poll`）已安排当前任务在以后可以取得进展时被唤醒，例如当网络数据包到达时。

通过使用非阻塞的Tokio I/O类型，如果一个执行I/O操作的Future不能立即执行，也不会阻止其他Future的执行，它只是返回 `NotReady`，并依赖于<ruby>任务通知<rt>task notification</rt></ruby>，使`poll`方法再次被调用，那时该I/O应该会成功且不会阻塞。

在幕后，Tokio使用[mio](https://docs.rs/mio/*/mio)和[tokio-fs](https://docs.rs/tokio/0.1/tokio/fs/index.html)跟踪不同futures等待的各种I/O资源的状态，只要其中任何一个的状态发生变化，操作系统就会通知它。

## 一个服务器例子

要了解它如何工作，请考虑以下[echo
服务器](https://tools.ietf.org/html/rfc862)的实现：

```rust
use tokio::prelude::*;
use tokio::net::TcpListener;

// Set up a listening socket, just like in std::net
let addr = "127.0.0.1:12345".parse().unwrap();
let listener = TcpListener::bind(&addr)
    .expect("unable to bind TCP listener");

// Listen for incoming connections.
// This is similar to the iterator of incoming connections that
// .incoming() from std::net::TcpListener, produces, except that
// it is an asynchronous Stream of tokio::net::TcpStream instead
// of an Iterator of std::net::TcpStream.
let incoming = listener.incoming();

// Since this is a Stream, not an Iterator, we use the for_each
// combinator to specify what should happen each time a new
// connection becomes available.
let server = incoming
    .map_err(|e| eprintln!("accept failed = {:?}", e))
    .for_each(|socket| {
        // Each time we get a connection, this closure gets called.
        // We want to construct a Future that will read all the bytes
        // from the socket, and write them back on that same socket.
        //
        // If this were a TcpStream from the standard library, a read or
        // write here would block the current thread, and prevent new
        // connections from being accepted or handled. However, this
        // socket is a Tokio TcpStream, which implements non-blocking
        // I/O! So, if we read or write from this socket, and the
        // operation would block, the Future will just return NotReady
        // and then be polled again in the future.
        //
        // While we *could* write our own Future combinator that does an
        // (async) read followed by an (async) write, we'll instead use
        // tokio::io::copy, which already implements that. We split the
        // TcpStream into a read "half" and a write "half", and use the
        // copy combinator to produce a Future that asynchronously
        // copies all the data from the read half to the write half.
        let (reader, writer) = socket.split();
        let bytes_copied = tokio::io::copy(reader, writer);
        let handle_conn = bytes_copied.map(|amt| {
            println!("wrote {:?} bytes", amt)
        }).map_err(|err| {
            eprintln!("I/O error {:?}", err)
        });

        // handle_conn here is still a Future, so it hasn't actually
        // done any work yet. We *could* return it here; then for_each
        // would wait for it to complete before it accepts the next
        // connection. However, we want to be able to handle multiple
        // connections in parallel, so we instead spawn the future and
        // return an "empty" future that immediately resolves so that
        // Tokio will _simultaneously_ accept new connections and
        // service this one.
        tokio::spawn(handle_conn)
    });

// The `server` variable above is itself a Future, and hasn't actually
// done any work yet to set up the server. We need to run it on a Tokio
// runtime for the server to really get up and running:
tokio::run(server);
```

更多例子，请参考 [这里](https://github.com/tokio-rs/tokio/tree/master/examples).
