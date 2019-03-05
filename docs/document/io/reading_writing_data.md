# 读写数据

## 非阻塞I/O

在[概述](./overview/)我们简单提到的是tokio的I/O类型实现了无阻塞异步版`std::io::Read`和`std::io::Write`，名为 [AsyncRead](https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncRead.html)和[AsyncWrite](https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncWrite.html)。这些是Tokio的I/O中不可或缺的一部分，在使用I/O代码时，理解这些东东非常重要。

注意：在本节中，我们将主要讨论`AsyncRead`， `AsyncWrite`几乎完全相同，只是将数据写入I/O资源（如TCP套接字）而不是从中读取。

好，让我们来看看，`AsyncRead`能干什么：

```rust
use std::io::Read;
pub trait AsyncRead: Read {
    // ...
    // various provided methods
    // ...
}
```

嗯，这都说了些啥？嗯，`AsyncRead`只是继承了`std::io`中的`Read`，以及一份额外的契约。`AsyncRead`文档中提到：

> 此trait继承自`std::io::Read`并表明I/O对象是非阻塞的。**当无可用数据时，所有非阻塞I/O对象都必须返回一个error而不是阻塞当前线程。**

最后一部分至关重要。如果你为一个类型实现`AsyncRead`，你得保证调用`read`而不会阻塞。相反，如果它不是非阻塞的，则应该返回`io::ErrorKind::WouldBlock`错误以表明操作将被阻塞（例如因为没有可用的数据）。`poll_read`方法依赖于此：

```rust
fn poll_read(&mut self, buf: &mut [u8]) -> Poll<usize, std::io::Error> {
    match self.read(buf) {
        Ok(t) => Ok(Async::Ready(t)),
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            Ok(Async::NotReady)
        }
        Err(e) => Err(e),
    }
}
```

这段代码应该很熟悉。如果仔细看一眼，`poll_read` 看起来很像`Future::poll`。那是因为它基本上就是！一个实现`AsyncRead`的类型本质上就是一个可以尝试从中读取数据的Future，它将通知你是否`Ready`（某些数据已被读取）或`NotReady`（你需要再次`poll_read`）。

## 使用I/O Future

由于`AsyncRead`（和`AsyncWrite`）几乎都是Futures，你可以很容易地将它们嵌入到你自己的Futures中，`poll_read`它们，就像`poll`任何其他嵌入Future一样。您甚至可以根据需要使用`try_ready!`， 这个micro可以传递error和`NotReady`状态。我们将在下一节中更多地讨论如何直接使用这些traits。但是，在许多情况下，为了简化，Tokio在`tokio::io`中提供了许多有用的<ruby>组合器<rt>combinator</rt></ruby>，用于在`AsyncRead`和`AsyncWrite`之上执行常见的I/O操作。通常，它们封装了`AsyncRead`或`AsyncWrite`类型，实现了`Future`，并在给定的读或写操作完成时完成。

第一个好用的I/O组合器是`read_exact`。它需要一个可变的buffer（`&mut [u8]`）和`AsyncRead`的实现作为参数，并返回一个`Future`读取足够的字节来填充buffer。在内部，返回的future只是跟踪它已经读取了多少字节，并在`AsyncRead`时继续发出`poll_ready` （如果需要，返回`NotReady`），直到它正好填满了buffer。那时，它返回带着填满的buffer的`Ready(buf)`。让我们来看看：

```rust
use tokio::net::tcp::TcpStream;
use tokio::prelude::*;

let addr = "127.0.0.1:12345".parse().unwrap();
let read_8_fut = TcpStream::connect(&addr)
    .and_then(|stream| {
        // We need to create a buffer for read_exact to write into.
        // A Vec<u8> is a good starting point.
        // read_exact will read buffer.len() bytes, so we need
        // to make sure the Vec isn't empty!
        let mut buf = vec![0; 8];

        // read_exact returns a Future that resolves when
        // buffer.len() bytes have been read from stream.
        tokio::io::read_exact(stream, buf)
    })
    .inspect(|(_stream, buf)| {
        // Notice that we get both the buffer and the stream back
        // here, so that we can now continue using the stream to
        // send a reply for example.
        println!("got eight bytes: {:x?}", buf);
    });

// We can now either chain more futures onto read_8_fut,
// or if all we wanted to do was read and print those 8
// bytes, we can just use tokio::run to run it (taking
// care to map Future::Item and Future::Error to ()).
```

第二个常用的I/O组合器是`write_all`。它需要一个buffer（`&[u8]`）和一个`AsyncWrite`的实现作为参数，并返回一个将缓冲区的所有字节用`poll_write`写入` AsyncWrite`的future。当Future被resolve，整个缓冲区已经写完并被刷新。我们可以结合 `read_exact`使用，来echo服务器的任何内容：

```rust
use tokio::net::tcp::TcpStream;
use tokio::prelude::*;

let echo_fut = TcpStream::connect(&addr)
    .and_then(|stream| {
        // We're going to read the first 32 bytes the server sends us
        // and then just echo them back:
        let mut buf = vec![0; 32];
        // First, we need to read the server's message
        tokio::io::read_exact(stream, buf)
    })
    .and_then(|(stream, buf)| {
        // Then, we use write_all to write the entire buffer back:
        tokio::io::write_all(stream, buf)
    })
    .inspect(|(_stream, buf)| {
        println!("echoed back {} bytes: {:x?}", buf.len(), buf);
    });

// As before, we can chain more futures onto echo_fut,
// or declare ourselves finished and run it with tokio::run.
```

Tokio还带有一个I/O组合器来实现上面例子中这种复制。它（或许不足为奇）被称为`copy`。`copy`接受一个`AsyncRead`和一个`AsyncWrite`，连续地将从中`AsyncRead`读出的所有字节，写入到`AsyncWrite`，直到 `poll_read`指示输入已经关闭并且所有字节都已写出并刷新到输出。这是我们在echo服务器中使用的组合器！它大大简化了我们上面的示例，并使其适用于任何量级的服务器数据！

```rust
use tokio::net::tcp::TcpStream;
use tokio::prelude::*;

let echo_fut = TcpStream::connect(&addr)
    .and_then(|stream| {
        // First, we need to get a separate read and write handle for
        // the connection so that we can forward one to the other.
        // See "Split I/O resources" below for more details.
        let (reader, writer) = stream.split();
        // Then, we can use copy to send all the read bytes to the
        // writer, and return how many bytes it read/wrote.
        tokio::io::copy(reader, writer)
    })
    .inspect(|(bytes_copied, r, w)| {
        println!("echoed back {} bytes", bytes_copied);
    });
```

简约！

到目前为止我们谈到的组合器都是用于相当底层的操作：读取字节，写入字节，复制字节。但是，通常情况下，您希望在更高级别的表述上操作，例如“lines”。这些Tokio也帮你搞定了！`lines`接受一个 `AsyncRead`，并返回一个`Stream`，从输入中<ruby>产生<rt>yield</rt></ruby>每一行，直到没有更多行要读：

```rust
use tokio::net::tcp::TcpStream;
use tokio::prelude::*;

let lines_fut = TcpStream::connect(&addr).and_then(|stream| {
    // We want to parse out each line we receive on stream.
    // To do that, we may need to buffer input for a little while
    // (if the server sends two lines in one packet for example).
    // Because of that, lines requires that the AsyncRead it is
    // given *also* implements BufRead. This may be familiar if
    // you've ever used the lines() method from std::io::BufRead.
    // Luckily, BufReader from the standard library gives us that!
    let stream = std::io::BufReader::new(stream);
    tokio::io::lines(stream).for_each(|line| {
        println!("server sent us the line: {}", line);
        // This closure is called for each line we receive,
        // and returns a Future that represents the work we
        // want to do before accepting the next line.
        // In this case, we just wanted to print, so we
        // don't need to do anything more.
        Ok(())
    })
});
```

在`tokio::io`中，还有更多的I/O组合器，在你决定自己写一个之前，不妨先看一下是否已经有了实现！

## 拆分I/O资源

上面的`copy`和echo服务器例子中都包含下面这个神秘的代码片段：

```rust
let (reader, writer) = socket.split();
let bytes_copied = tokio::io::copy(reader, writer);
```

正如上面的注释所解释的那样，我们将`TcpStream`（`socket`）拆分为*读半*部分和*写半*部分，并使用我们上面讨论的`copy`组合器产生一个Future异步复制从*读半*部分到*写半*部分的所有数据。但究竟为什么需要这种“split”呢？毕竟，`AsyncRead::poll_read`和 `AsyncWrite::poll_write`只接受参数`&mut self`。

要回答这个问题，我们需要回顾一下Rust的Ownership机制。回想一下，Rust只允许你在任一时刻对一给定变量拥有单个可变引用。但是我们必须传递*两个* 参数给`copy`，一个用于从哪里读，另一个指定写到哪里。但是，一旦我们将一个可变引用作为其中一个参数传递给`TcpStream`，我们就不能构造第二个指向它的可变引用作为第二个参数传递给它！我们知道，`copy` 将不能同时读取和写入到其参数，但是这并没有在`copy`的类型定义中表示出来。

进入`split`方法，一个`AsyncRead`中提供的方法也实现了`AsyncWrite`。如果我们看一下方法签名，我们就会看到：

```rust
fn split(self) -> (ReadHalf<Self>, WriteHalf<Self>)
  where Self: AsyncWrite { ... }
```

返回的`ReadHalf`实现了`AsyncRead`，`WriteHalf` 实现了`AsyncWrite`。至关重要的是，我们现在有两个*独立的* 指针在我们的类型中，我们可以单独传递它们。这很方便`copy`，但这也意味着我们可以将每一*半*传递到不同的Future，并完全独立地处理读写操作！在幕后，`split`确保如果我们同时尝试读写，一次只发生其中一个。

## 传输

在I/O应用中，将一个`AsyncRead`转换为`Stream`（像`lines`这样）或 将一个`AsyncWrite`转化为`Sink`相当普遍。他们经常想要把从网络上读、写字节的方式进行抽象，并让大多数应用程序代码处理更方便的“request”和“response”类型。这通常被称为“framing”：您可以将它们视为接收和发送的应用程序数据的“帧”，而不仅仅视您的连接视为字节进、字节出。帧化的字节流通常被称为“传输”。

传输通常使用编<ruby>解码器<rt>codec</rt></ruby>实现。例如， `lines`表述了一个非常简单的编解码器，用换行符`\n`分割字节字符串，并在将其传递给应用程序之前，将每个帧作为字符串解析。Tokio在`tokio::codec`中提供了helpers来帮助实现新的编解码器; 你为你的传输实现了`Encoder`和 `Decoder` traits，并用`Framed::new`从你的字节流中创建一个`Sink + Stream`（比如一个`TcpStream`）。这几乎就像魔术一样！有些编解码器只用读或写端（比如`lines`）。让我们来看一下编写基于行的编解码器的简单实现（即使`LinesCodec` 已经存在）：

```rust
extern crate bytes;
use bytes::{BufMut, BytesMut};
use tokio::codec::{Decoder, Encoder};
use tokio::prelude::*;

// This is where we'd keep track of any extra book-keeping information
// our transport needs to operate.
struct LinesCodec;

// Turns string errors into std::io::Error
fn bad_utf8<E>(_: E) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, "Unable to decode input as UTF8")
}

// First, we implement encoding, because it's so straightforward.
// Just write out the bytes of the string followed by a newline!
// Easy-peasy.
impl Encoder for LinesCodec {
    type Item = String;
    type Error = std::io::Error;

    fn encode(&mut self, line: Self::Item, buf: &mut BytesMut) -> Result<(), Self::Error> {
        // Note that we're given a BytesMut here to write into.
        // BytesMut comes from the bytes crate, and aims to give
        // efficient read/write access to a buffer. To use it,
        // we have to reserve memory before we try to write to it.
        buf.reserve(line.len() + 1);
        // And now, we write out our stuff!
        buf.put(line);
        buf.put_u8(b'\n');
        Ok(())
    }
}

// The decoding is a little trickier, because we need to look for
// newline characters. We also need to handle *two* cases: the "normal"
// case where we're just asked to find the next string in a bunch of
// bytes, and the "end" case where the input has ended, and we need
// to find any remaining strings (the last of which may not end with a
// newline!
impl Decoder for LinesCodec {
    type Item = String;
    type Error = std::io::Error;

    // Find the next line in buf!
    fn decode(&mut self, buf: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        Ok(if let Some(offset) = buf.iter().position(|b| *b == b'\n') {
            // We found a newline character in this buffer!
            // Cut out the line from the buffer so we don't return it again.
            let mut line = buf.split_to(offset + 1);
            // And then parse it as UTF-8
            Some(
                std::str::from_utf8(&line[..line.len() - 1])
                    .map_err(bad_utf8)?
                    .to_string(),
            )
        } else {
            // There are no newlines in this buffer, so no lines to speak of.
            // Tokio will make sure to call this again when we have more bytes.
            None
        })
    }

    // Find the next line in buf when there will be no more data coming.
    fn decode_eof(&mut self, buf: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        Ok(match self.decode(buf)? {
            Some(frame) => {
                // There's a regular line here, so we may as well just return that.
                Some(frame)
            },
            None => {
                // There are no more lines in buf!
                // We know there are no more bytes coming though,
                // so we just return the remainder, if any.
                if buf.is_empty() {
                    None
                } else {
                    Some(
                        std::str::from_utf8(&buf.take()[..])
                            .map_err(bad_utf8)?
                            .to_string(),
                    )
                }
            }
        })
    }
}
```