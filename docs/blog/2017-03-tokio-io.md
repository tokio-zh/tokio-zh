# 宣布tokio-io Crate

今天我们很高兴地宣布一个新的箱子和几个新工具
在Tokio堆栈中。这代表了许多并行的高潮
对各种零碎的更新，它们恰好便于降落
大约在同一时间！简而言之，改进是：

* 从[tokio-core]中提取的新[tokio-io]箱子，弃用了
  [`tokio_core :: io`]模块。
* 将[bytes] crate引入[tokio-io]，允许抽象结束
  缓冲和利用矢量I / O等基础功能。
* 在“Sink”特征中添加一种新方法“close”，以表达优雅
  关掉。

这些更改改进了Tokio的组织和抽象
几个长期存在的问题，应该为所有人提供稳定的基础
未来的发展。与此同时，这些变化并没有破坏
旧的`io`模块仍然以不推荐的形式提供。你可以开始全部使用了
这些箱子立即通过`cargo update`并使用最新的`0.1。*`
板条箱的版本！

让我们更深入地了解每个细节的变化，看看现在有什么可用。

## 添加一个`tokio-io`箱子

现有的[`tokio_core :: io`]模块提供了许多有用的抽象
但它们并不是[tokio-core]本身所特有的，也不是它的主要目的
[tokio-io] crate是提供这些核心实用程序而没有任何含义
运行时。使用[tokio-io] crates可以依赖于异步I / O语义
而不是将自己绑定到特定的运行时，例如[tokio-core]。
[tokio-io] crate旨在类似于[`std :: io`]标准
库模块在为异步提供通用抽象方面
生态系统。 [tokio-io]中提出的概念和特征是基础
对于在Tokio堆栈中完成的所有I / O.

[tokio-io]的主要内容是[`AsyncRead`]和[`AsyncWrite`]
特征。这两个特征是一种“分裂[`Io`]特征”并被选中
划分实现类似Tokio的读/写语义的类型（非阻塞
并通知未来的任务）。然后这些特征与[字节]集成
箱子提供一些方便的功能，并保留旧的功能，如
[`split`]。

我们还有机会刷新[`Codec`]特征
[tokio-core] crate到[`Encoder`]和[`Decoder`]特征，它们可以运行
[bytes] crate中的类型（[`EasyBuf`]在[tokio-io]中不存在，而且它是
现在在[tokio-core]中弃用了。这些类型允许您快速移动
字节流到[`Sink`]和[`Stream`]准备好接受成帧消息。
一个很好的例子就是使用[tokio-io]我们可以使用新的
[`length_delimited`]模块结合[tokio-serde-json]起床和
我们将在本文后面看到，立即使用JSON RPC服务器运行。

总的来说，[tokio-io]我们也能够重新审视几个小问题
API设计。这反过来使我们能够[关闭一大堆
问题] [关闭]反对[tokio-core]。我们觉得[tokio-io]是一个很好的补充
向前移动的Tokio堆栈。板条箱可以选择抽象
如果他们愿意的话，[tokio-io]不会像[tokio-core]那样拉动运行时间。

## 集成`bytes`

[tokio-core]的一个长期疣是它的[`EasyBuf`]字节缓冲区类型。
这种类型基本上就是它所说的锡（“简单”缓冲区），但是
遗憾的是，在高性能用例中通常不是您想要的。我们已经
长期以来希望有更好的抽象（以及更好的具体实现）
这里。

使用[tokio-io]你会发现[crates.io]上的[bytes]箱子更多
紧密集成并提供高性能所需的抽象
和“简单”缓冲同时。 [bytes]箱子的主要内容是
[`Buf`]和[`BufMut`]特征。这两个特征充当了能力
任意字节缓冲区（可读和可写）都是抽象的
在所有异步I / O对象上集成了[`read_buf`]和[`write_buf`]
现在。

除了用于抽象多种缓冲区的特性[bytes] crate
有两个高质量的这些特征实现，[`Bytes`]和
[`BytesMut`]类型（分别实现[`Buf`]和[`BufMut`]特征）。
简而言之，这些类型代表允许的引用计数缓冲区
以有效的方式对数据切片进行零拷贝提取。引导他们
还支持各种常见操作，如微小缓冲区（内联
存储），单一所有者（可以在内部使用`Vec`），共享所有者
不相交的视图（`BytesMut`），以及可能重叠视图的共享所有者
（`Bytes`）。

总的来说，我们希望的[字节]包是你的一站式字节缓冲区
抽象以及高质量的实现，让您运行
很快。我们很高兴看到[bytes]箱子里面有什么东西！

## 添加`Sink :: close`

我们最近登陆的最后一个重大变化是增加了一个新的
关于的方法

## 添加 `Sink::close`

我们最近登陆的最后一个重大变化是增加了一个新的
[`Sink`]特征的方法，[`close`]。 到目前为止还不是很好
关于以通用方式实现“优雅关闭”的故事，因为那里
没有干净的方式向水槽表明没有更多的物品被推入
它。 新的[`close`]方法正是为此目的而准备的。

[`close`]方法允许通知接收器不再有消息
推进去了。 然后，接收器可以借此机会刷新消息
否则执行协议特定的关闭。 例如，TLS连接
该点可能会启动关闭操作或代理连接
发出TCP级别的关闭。 通常情况下，这最终会触底到新的
[`AsyncWrite :: shutdown`]方法。

## 添加 `codec::length_delimited`

使用[tokio-io]登陆的一个大功能是添加
[`length_delimited`]模块（受Netty的启发
[`LengthFieldBasedFrameDecoder`]）。 许多协议使用a来分隔帧
包含帧长度的帧头。 举一个简单的例子，拿一个
使用`u32`的帧头来划分帧有效载荷的协议。 每
电线上的框架看起来像这样：

```text
+----------+--------------------------------+
| len: u32 |          frame payload         |
+----------+--------------------------------+
```

解析此协议可以轻松处理

```rust
// Bind a server socket
let socket = TcpStream::connect(
    &"127.0.0.1:17653".parse().unwrap(),
    &handle);

socket.and_then(|socket| {
    // Delimit frames using a length header
    let transport = length_delimited::FramedWrite::new(socket);
})
```

在上面的例子中，`transport`将是缓冲区的`Sink + Stream`
值，其中每个缓冲区包含帧有效负载。 这使得
将帧编码和解码为相当容易的值
像[serde]这样的东西。 例如，使用[tokio-serde-json]，我们可以
快速实现基于JSON的协议，其中每个帧都是长度
分隔，并使用JSON编码帧有效负载：

```rust
// Bind a server socket
let socket = TcpStream::connect(
    &"127.0.0.1:17653".parse().unwrap(),
    &handle);

socket.and_then(|socket| {
    // Delimit frames using a length header
    let transport = length_delimited::FramedWrite::new(socket);

    // Serialize frames with JSON
    let serialized = WriteJson::new(transport);

    // Send the value
    serialized.send(json!({
        "name": "John Doe",
        "age": 43,
        "phones": [
            "+44 1234567",
            "+44 2345678"
        ]
    }))
})
```

完整的例子就在[这里](https://github.com/carllerche/tokio-serde-json/tree/master/examples)。

length_delimited模块包含足够的配置设置来处理具有更复杂帧头的解析长度分隔帧，如HTTP / 2.0协议。

## 下一步是什么？

所有这些变化汇集在一起​​，关闭了期货和托克欧核心板条箱中的大量问题，我们认为Tokio正是我们喜欢的常见I / O和缓冲抽象的位置。一如既往，我们很乐意听到有关问题跟踪器的反馈，如果您发现问题，我们非常愿意合并PR！否则我们期待在实践中看到所有这些变化！

凭借tokio-core，tokio-io，tokio-service和tokio-proto的基础，Tokio团队期待着适应和实施更加雄心勃勃的协议，如HTTP / 2。我们正在与@seanmonstar和Hyper密切合作，以开发这些基础HTTP库。最后，我们希望在不久的将来扩展与HTTP和通用tokio服务实现相关的中间件故事。更多关于这个即将到来！

[`AsyncWrite::shutdown`]: https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncWrite.html#tymethod.shutdown
[`close`]: https://docs.rs/futures/0.1/futures/sink/trait.Sink.html#method.close
[`Bytes`]: http://carllerche.github.io/bytes/bytes/struct.Bytes.html
[`BytesMut`]: http://carllerche.github.io/bytes/bytes/struct.BytesMut.html
[`read_buf`]: https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncRead.html#method.read_buf
[`write_buf`]: https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncWrite.html#method.write_buf
[`Buf`]: http://carllerche.github.io/bytes/bytes/trait.Buf.html
[`BufMut`]: http://carllerche.github.io/bytes/bytes/trait.BufMut.html
[crates.io]: https://crates.io
[tokio-io]: https://crates.io/crates/tokio-io
[futures]: https://crates.io/crates/futures
[tokio-core]: https://crates.io/crates/tokio-core
[tokio-service]: https://crates.io/crates/tokio-service
[tokio-proto]: https://crates.io/crates/tokio-proto
[bytes]: https://crates.io/crates/bytes
[`tokio_core::io`]: https://docs.rs/tokio-core/0.1/tokio_core/io/
[`Io`]: https://docs.rs/tokio-core/0.1/tokio_core/io/trait.Io.html
[`Codec`]: https://docs.rs/tokio-core/0.1/tokio_core/io/trait.Codec.html
[`Stream`]: https://docs.rs/futures/0.1/futures/stream/trait.Stream.html
[`Sink`]: https://docs.rs/futures/0.1/futures/sink/trait.Sink.html
[`std::io`]: https://doc.rust-lang.org/std/io/
[`AsyncWrite`]: https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncWrite.html
[`AsyncRead`]: https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncRead.html
[`split`]: https://docs.rs/tokio-io/0.1/tokio_io/trait.AsyncRead.html#method.split
[`Encoder`]: https://docs.rs/tokio-io/0.1/tokio_io/codec/trait.Encoder.html
[`Decoder`]: https://docs.rs/tokio-io/0.1/tokio_io/codec/trait.Decoder.html
[`EasyBuf`]: https://docs.rs/tokio-core/0.1/tokio_core/io/struct.EasyBuf.html
[`length_delimited`]: https://docs.rs/tokio-io/0.1/tokio_io/codec/length_delimited/index.html
[closing]: https://github.com/tokio-rs/tokio-core/issues/61#issuecomment-277568977
[tokio-serde-json]: https://github.com/carllerche/tokio-serde-json
[sean]: https://github.com/seanmonstar
[Hyper]: https://github.com/hyperium/hyper
