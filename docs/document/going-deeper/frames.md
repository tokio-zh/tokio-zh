# 使用构建流

Tokio有助手将字节流转换为帧流。 字节流的示例包括TCP连接，管道，文件对象以及标准输入和输出文件描述符。 在Rust中，流很容易识别，因为它们实现了读写 `trait`。

框架消息的最简单形式之一是行分隔消息。 每条消息都以`\ n`字符结尾。 让我们看一下如何使用tokio实现行分隔消息流。

## 编写编解码器

编解码器实现了`tokio_codec :: Decoder`和`tokio_codec :: Encoder` `trait`。 它的工作是将帧转换为字节和从字节转换。 这些 `trait`与tokio_codec :: Framed结构一起使用，以提供字节流的缓冲，解码和编码。

让我们看一下LinesCodec结构的简化版本，它实现了行分隔消息的解码和编码。

```rust
pub struct LinesCodec {
    // Stored index of the next index to examine for a `\n` character.
    // This is used to optimize searching.
    // For example, if `decode` was called with `abc`, it would hold `3`,
    // because that is the next index to examine.
    // The next time `decode` is called with `abcde\n`, the method will
    // only look at `de\n` before returning.
    next_index: usize,
}
```

这里的注释解释了，由于字节被缓冲直到找到一行，因此每次收到数据时从缓冲区的开头搜索`\ n`是很浪费的。 保持缓冲区的最后长度并在收到新数据时从那里开始搜索更有效。

当在底层流上接收数据时，调用Decoder :: decode方法。 该方法可以生成一个帧或返回Ok（None）来表示它需要更多的数据来生成一个帧。 解码方法负责通过使用BytesMut方法将其拆分来删除不再需要缓冲的数据。 如果未删除数据，缓冲区将继续增长。

我们来看看如何为`LinesCodec`实现`Decoder :: decode`。

```rust
fn decode(&mut self, buf: &mut BytesMut) -> Result<Option<String>, io::Error> {
    // Look for a byte with the value '\n' in buf. Start searching from the search start index.
    if let Some(newline_offset) = buf[self.next_index..].iter().position(|b| *b == b'\n')
    {
        // Found a '\n' in the string.

        // The index of the '\n' is at the sum of the start position + the offset found.
        let newline_index = newline_offset + self.next_index;

        // Split the buffer at the index of the '\n' + 1 to include the '\n'.
        // `split_to` returns a new buffer with the contents up to the index.
        // The buffer on which `split_to` is called will now start at this index.
        let line = buf.split_to(newline_index + 1);

        // Trim the `\n` from the buffer because it's part of the protocol,
        // not the data.
        let line = &line[..line.len() - 1];

        // Convert the bytes to a string and panic if the bytes are not valid utf-8.
        let line = str::from_utf8(&line).expect("invalid utf8 data");

        // Set the search start index back to 0.
        self.next_index = 0;

        // Return Ok(Some(...)) to signal that a full frame has been produced.
        Ok(Some(line.to_string()))
    } else {
        // '\n' not found in the string.

        // Tell the next call to start searching after the current length of the buffer
        // since all of it was scanned and no '\n' was found.
        self.next_index = buf.len();

        // Ok(None) signifies that more data is needed to produce a full frame.
        Ok(None)
    }
}
```

当必须将帧写入底层流时，将调用Encoder :: encode方法。 必须将帧写入作为参数接收的缓冲区。 写入缓冲区的数据将在准备好发送数据时写入流。

现在让我们看看如何为LinesCodec实现Encoder :: encode。

```rust
fn encode(&mut self, line: String, buf: &mut BytesMut) -> Result<(), io::Error> {
    // It's important to reserve the amount of space needed. The `bytes` API
    // does not grow the buffers implicitly.
    // Reserve the length of the string + 1 for the '\n'.
    buf.reserve(line.len() + 1);

    // String implements IntoBuf, a trait used by the `bytes` API to work with
    // types that can be expressed as a sequence of bytes.
    buf.put(line);

    // Put the '\n' in the buffer.
    buf.put_u8(b'\n');

    // Return ok to signal that no error occured.
    Ok(())
}
```

编码信息通常更简单。 这里我们只需保留所需的空间并将数据写入缓冲区。

## 使用编解码器

使用编解码器的最简单方法是使用Framed结构。 它是实现自动缓冲的编解码器的包装器。 Framed结构体既是Stream又是Sink。 因此，您可以从中接收帧并向其发送帧。

您可以使用AsyncRead :: framed方法使用任何实现AsyncRead和AsyncWrite `trait`的类型创建Framed结构。

```rust
TcpStream::connect(&addr).and_then(|sock| {
    let framed_sock = Framed::new(sock, LinesCodec::new());
    framed_sock.for_each(|line| {
        println!("Received line {}", line);
        Ok(())
    })
});
```