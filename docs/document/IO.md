# Tokio与I/O

tokio crate带有TCP和UDP网络类型。 与std中的类型不同，Tokio的网络类型基于轮询模型，并在其准备状态发生变化（接收数据并刷写写入缓冲区）时通知任务执行程序。 在tokio :: net模块中，您将找到TcpListener，TcpStream和UdpSocket等类型。

所有这些类型都提供了`future`的API以及poll API。

Tokio网络类型由基于Mio的反应器提供动力，默认情况下，它在后台线程上懒洋洋地启动。 有关详细信息，请参阅reactor文档。

使用Future API
我们已经在本指南的前面已经看到了一些传入函数以及tokio_io :: io中的助手。

这些助手包括：

* incoming：入站TCP连接流。
* read_exact：准确读取n个字节到缓冲区。
* read_to_end：将所有字节读入缓冲区。
* write_all：写入缓冲区的全部内容。
* copy：将字节从一个I / O句柄复制到另一个I / O句柄。

很多这些函数/帮助程序都是AsyncRead和AsyncWrite特性的通用函数。这些特征类似于std的Read和Write，但仅适用于“`future`感知”的类型，即遵循强制属性：

* 调用读取或写入是非阻塞的，它们永远不会阻塞调用线程。
* 如果一个调用会以其他方式阻塞，那么会返回一个带有此类WillBlock的错误。如果发生这种情况，则当前`future`的任务计划在I / O再次准备就绪时接收通知（取消停放）
  
**请注意** AsyncRead和AsyncWrite类型的用户应使用poll_read和poll_write，而不是直接调用read和write。

例如，以下是如何接受连接，从它们读取5个字节，然后将5个字节写回套接字：

```rust
let server = listener.incoming().for_each(|socket| {
    println!("accepted socket; addr={:?}", socket.peer_addr().unwrap());

    let buf = vec![0; 5];

    let connection = io::read_exact(socket, buf)
        .and_then(|(socket, buf)| {
            io::write_all(socket, buf)
        })
        .then(|_| Ok(())); // Just discard the socket and buffer

    // Spawn a new task that processes the socket:
    tokio::spawn(connection);

    Ok(())
})
```

## 使用Poll API

手动实现Future时将使用基于Poll的API，您需要返回Async。 当您需要实现自己的处理自定义逻辑的组合器时，这非常有用。

例如，这就是如何为TcpStream实现read_exact的`future`。

```rust
pub struct ReadExact {
    state: State,
}

enum State {
    Reading {
        stream: TcpStream,
        buf: Vec<u8>,
        pos: usize,
    },
    Empty,
}

impl Future for ReadExact {
    type Item = (TcpStream, Vec<u8>);
    type Error = io::Error;

    fn poll(&mut self) -> Result<Async<Self::Item>, io::Error> {
        match self.state {
            State::Reading {
                ref mut stream,
                ref mut buf,
                ref mut pos
            } => {
                while *pos < buf.len() {
                    let n = try_ready!({
                        stream.poll_read(&mut buf[*pos..])
                    });
                    *pos += n;
                    if n == 0 {
                        let err = io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "early eof");

                        return Err(err)
                    }
                }
            }
            State::Empty => panic!("poll a ReadExact after it's done"),
        }

        match mem::replace(&mut self.state, State::Empty) {
            State::Reading { stream, buf, .. } => {
                Ok(Async::Ready((stream, buf)))
            }
            State::Empty => panic!(),
        }
    }
}
```

## 数据报(Datagrams)

**请注意** ，大多数讨论都是围绕I / O或字节流进行的，而UDP重要的不是！ 但是，为了适应这种情况，UdpSocket类型还提供了许多方便的方法：

* `send_dgram`允许您表示将数据报作为`future`发送，如果无法立即发送整个数据报，则返回错误。
* `recv_dgram`表示将数据报读入缓冲区，产生缓冲区和来自的地址。