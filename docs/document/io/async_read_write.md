# 直接使用AsyncRead和AsyncWrite

到目前为止，我们都是在Tokio提供的I/O组合器场景下讨论了`AsyncRead`和`AsyncWrite`。通常这些就够了，但有时您需要实现自己的组合器，直接执行异步读写。

## 用`AsyncRead`读取数据

`AsyncRead`的核心是`poll_read`方法。该方法检查`Err`类型是否为`WouldBlock`，如果是，表明I/O `read`操作可能被阻塞的，则返回`NotReady`，这就使我们可以与futures互操作。当你写一个内部包含`AsyncRead`的Future（或类似的东西，例如`Stream`）时，`poll_read` 很可能就是你将要与之交互的方法。

要记住一点：`poll_read`遵循与`Future::poll`相同的契约。具体而言，你不能返回`NotReady`，除非你已安排当前任务在取得进展时，会被通知再次被调用。基于此，我们可以在自己futures的`poll`方法内调用`poll_read`; 当我们从`poll_read`中转发一个`NotReady`的时候，我们知道这是遵循`poll`合约的，因为`poll_read`遵循相同的合约。

Tokio用于确保`poll_read`以后通知当前<ruby>任务<rt>task</rt></ruby>的确切机制不在本节讨论的范围，但如果您感兴趣，可以在Tokio内部原理的[非阻塞I/O](../internals)中阅读更多相关内容。

有了这一切，让我们看看如何自己实现`read_exact` 这个方法！

```rust
#[macro_use]
extern crate futures;
use std::io;
use tokio::prelude::*;

// This is going to be our Future.
// In the common case, this is set to Some(Reading),
// but we'll set it to None when we return Async::Ready
// so that we can return the reader and the buffer.
struct ReadExact<R, T>(Option<Reading<R, T>>);

struct Reading<R, T> {
    // This is the stream we're reading from.
    reader: R,
    // This is the buffer we're reading into.
    buffer: T,
    // And this is how far into the buffer we've written.
    pos: usize,
}

// We want to be able to construct a ReadExact over anything
// that implements AsyncRead, and any buffer that can be
// thought of as a &mut [u8].
fn read_exact<R, T>(reader: R, buffer: T) -> ReadExact<R, T>
where
    R: AsyncRead,
    T: AsMut<[u8]>,
{
    ReadExact(Some(Reading {
        reader,
        buffer,
        // Initially, we've read no bytes into buffer.
        pos: 0,
    }))
}

impl<R, T> Future for ReadExact<R, T>
where
    R: AsyncRead,
    T: AsMut<[u8]>,
{
    // When we've filled up the buffer, we want to return both the buffer
    // with the data that we read and the reader itself.
    type Item = (R, T);
    type Error = io::Error;

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        match self.0 {
            Some(Reading {
                ref mut reader,
                ref mut buffer,
                ref mut pos,
            }) => {
                let buffer = buffer.as_mut();
                // Check that we haven't finished
                while *pos < buffer.len() {
                    // Try to read data into the remainder of the buffer.
                    // Just like read in std::io::Read, poll_read *can* read
                    // fewer bytes than the length of the buffer it is given,
                    // and we need to handle that by looking at its return
                    // value, which is the number of bytes actually read.
                    //
                    // Notice that we are using try_ready! here, so if poll_read
                    // returns NotReady (or an error), we will do the same!
                    // We uphold the contract that we have arranged to be
                    // notified later because poll_read follows that same
                    // contract, and _it_ returned NotReady.
                    let n = try_ready!(reader.poll_read(&mut buffer[*pos..]));
                    *pos += n;

                    // If no bytes were read, but there was no error, this
                    // generally implies that the reader will provide no more
                    // data (for example, because the TCP connection was closed
                    // by the other side).
                    if n == 0 {
                        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "early eof"));
                    }
                }
            }
            None => panic!("poll a ReadExact after it's done"),
        }

        // We need to return the reader and the buffer, which we can only
        // do by moving them out of self. We do this by taking our state
        // and leaving `None`. This _should_ be fine, because poll()
        // requires callers to not call poll() again after Ready has been
        // returned, so we should only ever see Some(Reading) when poll()
        // is called.
        let reading = self.0.take().expect("must have seen Some above");
        Ok(Async::Ready((reading.reader, reading.buffer)))
    }
}
```

## 用`AsyncWrite`写数据

就像`poll_read`是`AsyncRead`的核心一样，`poll_write`也是`AsyncWrite`的核心部分。和`poll_read`一样，该方法检查`Err`类型是否为`WouldBlock`，如果是，则表明`write`操作将被阻塞，就返回`NotReady`，这再次让我们与futures互操作。`AsyncWrite`也有一个`poll_flush`，它提供了一个`Write` `flush`的异步版本。`poll_flush`确保先前通过`poll_write`写入的任何字节都被刷到底层I/O资源上（例如，发送网络数据包）。类似于`poll_write`，它封装了`Write::flush`，映射`WouldBlock`错误为`NotReady`，指示flush仍在进行中。

`AsyncWrite`的`poll_write`，以及`poll_flush`都遵循与`Future::poll`和`AsyncRead::poll_read`相同的合约，即如果你想返回`NotReady`，则必须保证当前任务能够被在可以进行下去的时候被通知。和`poll_read`一样，这意味着我们可以安全地在我们自己的futures中调用这些方法，因为我们知道我们也在遵守合同。

Tokio使用和`poll_read`相同的通知机制来通知`poll_write`和`poll_flush`，你可以在Tokio内部原理的[非阻塞I/O](../internals)中阅读更多相关内容。

### 关闭

`AsyncWrite`还添加了一个不属于`Write`的方法：`shutdown`。从它的文档：

> 启动或尝试关闭此writer，在I/O连接完全关闭时返回成功。

此方法旨在用于I/O连接的异步关闭。例如，这适用于实现TLS连接的关闭或调用`TcpStream::shutdown`来关闭<ruby>代理连接<rt>proxied connection</rt></ruby>。一些协议有时需要清除最终的数据，或者发起优雅关闭握手，适当地读写更多数据。此方法就是实现这些协议所需的优雅关闭握手逻辑的钩子方法（扩展点）。

总结`shutdown`：它是一种告诉写一方不再有新数据产生的方法，并且它应该以底层I/O协议所需的任何方式指示。例如，对于TCP连接，这通常需要关闭TCP<ruby>通道<rt>channel</rt></ruby>的写入端，这样，另一端就可以读到0字节，表明已到文件尾。通常，你可以将`shutdown`视为你要实现`Drop`时你需要同步地执行的方法; 只是在异步世界中，你不能在`Drop`简单地处理，因为你需要有一个<ruby>执行器<rt>executor</rt></ruby>轮询你的writer！

请注意，在一个实现了`AsyncWrite`和`AsyncRead`的*写半*部分调用`shutdown`不会关闭*读半*部分。您通常可以继续随意读取数据，直到另一方关闭相应的*写半*。

### 一个使用`AsyncWrite`的例子

废话少说，让我们来看看我们如何实现：

```rust
#[macro_use]
extern crate futures;
use std::io;
use tokio::prelude::*;

// This is going to be our Future.
// It'll seem awfully familiar to ReadExact above!
// In the common case, this is set to Some(Writing),
// but we'll set it to None when we return Async::Ready
// so that we can return the writer and the buffer.
struct WriteAll<W, T>(Option<Writing<W, T>>);

struct Writing<W, T> {
    // This is the stream we're writing into.
    writer: W,
    // This is the buffer we're writing from.
    buffer: T,
    // And this is much of the buffer we've written.
    pos: usize,
}

// We want to be able to construct a WriteAll over anything
// that implements AsyncWrite, and any buffer that can be
// thought of as a &[u8].
fn write_all<W, T>(writer: W, buffer: T) -> WriteAll<W, T>
where
    W: AsyncWrite,
    T: AsRef<[u8]>,
{
    WriteAll(Some(Writing {
        writer,
        buffer,
        // Initially, we've written none of the bytes from buffer.
        pos: 0,
    }))
}

impl<W, T> Future for WriteAll<W, T>
where
    W: AsyncWrite,
    T: AsRef<[u8]>,
{
    // When we've written out the entire buffer, we want to return
    // both the buffer and the writer so that the user can re-use them.
    type Item = (W, T);
    type Error = io::Error;

    fn poll(&mut self) -> Poll<Self::Item, Self::Error> {
        match self.0 {
            Some(Writing {
                ref mut writer,
                ref buffer,
                ref mut pos,
            }) => {
                let buffer = buffer.as_ref();
                // Check that we haven't finished
                while *pos < buffer.len() {
                    // Try to write the remainder of the buffer into the writer.
                    // Just like write in std::io::Write, poll_write *can* write
                    // fewer bytes than the length of the buffer it is given,
                    // and we need to handle that by looking at its return
                    // value, which is the number of bytes actually written.
                    //
                    // We are using try_ready! here, just like in poll_read in
                    // ReadExact, so that if poll_write returns NotReady (or an
                    // error), we will do the same! We uphold the contract that
                    // we have arranged to be notified later because poll_write
                    // follows that same contract, and _it_ returned NotReady.
                    let n = try_ready!(writer.poll_write(&buffer[*pos..]));
                    *pos += n;

                    // If no bytes were written, but there was no error, this
                    // generally implies that something weird happened under us.
                    // We make sure to turn this into an error for the caller to
                    // deal with.
                    if n == 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::WriteZero,
                            "zero-length write",
                        ));
                    }
                }
            }
            None => panic!("poll a WriteAll after it's done"),
        }

        // We use the same trick as in ReadExact to ensure that we can return
        // the buffer and the writer once the entire buffer has been written out.
        let writing = self.0.take().expect("must have seen Some above");
        Ok(Async::Ready((writing.writer, writing.buffer)))
    }
}
```