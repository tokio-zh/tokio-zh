# Futures

在本指南早期提到的`future`是用于管理异步逻辑的构建块。 它们是Tokio使用的底层异步抽象。

`future`的实现由`future`crate提供。 但是，为方便起见，Tokio重新导出了许多类型。

## Futures是什么？

future是表示异步计算完成的值。通常，由于系统中某处发生的事件使`future`完成。虽然我们从基本I/O的角度看待事物，但您可以使用`future`来表示各种事件，例如：

* 在线程池中执行的数据库查询。当数据库查询完成时，`future` 完成，其值是查询的结果。

* 对服务器的RPC 调用。当服务器回复时，`future` 完成，其值是服务器的响应。

* 超时事件。当时间到了，`future`就完成了，它的值是（）。

* 在线程池上运行的长时间运行的CPU密集型任务。任务完成后，`future` 完成，其值为任务的返回值。

* 从套接字读取字节。当字节准备就绪时，`future`就完成了 - 根据缓冲策略，字节可能直接返回，或作为额外影响写入某个现有缓冲区。

`future`抽象的整个要点是允许异步函数，即不能立即返回值的函数，但是返回一些东西。

例如，异步HTTP客户端可以提供如下所示的get函数：

```rust
pub fn get(&self, uri: &str) -> ResponseFuture { ... }
```

然后，库的用户将使用该函数：

```rust
let response_future = client.get("https://www.example.com");
```

现在，response_future不是实际响应。这是个一旦收到响应，就会完成的`future`。 但是，调用者要具有一个具体的东西（`future`）使他们可以开始使用它。 例如，它们可以链式计算在接收到响应时执行，或者它们可能将`future`传递给函数。

```rust
let response_is_ok = response_future
    .map(|response| {
        response.status().is_ok()
    });

track_response_success(response_is_ok);
```

所有与`future`一起采取的行动都不会立即执行任何工作。他们不能，因为他们没有实际的HTTP响应。相反，他们定义了响应`future`完成时要完成的工作。

`future` crate和Tokio都有一系列组合功能，可以用来处理`future`。

## 实现`future`

使用Tokio时，实现Future是很常见的，因此适应它是很重要的。

如前一节所述，Rust`future`是基于轮询的。这是Rust`future`库的一个独特方面。其他编程语言的大多数`future`库使用基于推送的模型，其中回调被提供给`future`，并且计算立即调用计算结果回调。

使用基于轮询的模型提供了许多优点，包括作为零成本抽象，即，与手动编写异步代码相比，使用Rust`future`没有额外的开销。

`future`的特点如下：

```rust
trait Future {
    /// The type of the value returned when the future completes.
    type Item;

    /// The type representing errors that occured while processing the
    /// computation.
    type Error;

    fn poll(&mut self) -> Result<Async<Self::Item>, Self::Error>;
}
```

通常，当您实现Future时，您将定义一个由子（或内部）`future`组成的计算。 在这种情况下，`future`的实现会尝试调用内部`future`，如果内部`future`未准备好，则返回`NotReady`。

以下示例是由另一个返回`usize`并将使该值加倍的`future`组成的`future`：

```rust
pub struct Doubler<T> {
    inner: T,
}

pub fn double<T>(inner: T) -> Doubler<T> {
    Doubler { inner }
}

impl<T> Future for Doubler<T>
where T: Future<Item = usize>
{
    type Item = usize;
    type Error = T::Error;

    fn poll(&mut self) -> Result<Async<usize>, T::Error> {
        match self.inner.poll()? {
            Async::Ready(v) => Ok(Async::Ready(v * 2)),
            Async::NotReady => Ok(Async::NotReady),
        }
    }
}
```

当Doubler`future`被轮询时，它会调查其内在的`future`。 如果内部`future`尚未准备好，Doubler future将返回`NotReady`。 如果里面的的`future`已经准备就绪，那么Doubler的`future`会使返回值加倍并返回Ready。

因为上面的匹配模式很常见，所以`future` crate提供了一个宏：try_ready！。 它类似于`try！` 或`？`，但它也返回NotReady。 上面的poll函数可以使用try_ready重写！ 如下：

```rust
fn poll(&mut self) -> Result<Async<usize>, T::Error> {
    let v = try_ready!(self.inner.poll());
    Ok(Async::Ready(v * 2))
}
```

## 返回NotReady

当一个任务返回NotReady时，一旦它转换到就绪状态，执行者就会被通知。这使执行者能够有效地调度任务。

当函数返回`Async::NotReady`时，在状态转换为“就绪”时通知执行程序至关重要。否则，任务将无限挂起，永远不会再次运行。

对于大多数`future`的实现，这是可传递的。当`future`实施是子`future`的组合时，当至少一个内部`future`返回NotReady时，外部`future`仅返回`NotReady`。因此，一旦内部`future`转变为就绪状态，外部`future`将转变为就绪状态。在这种情况下，NotReady合约已经满足，因为内部`future`将在准备就绪时通知执行者。

最内层的`future`，有时也被称为“资源”，是负责通知执行人的人。这是通过对`task::current（）`返回的任务调用`notify`来完成的。

我们将在后面的部分中更深入地探索实施资源和任务系统。**除非你从内部的`future`获得NotReady，否则这里的关键是不要返回NotReady**

## 一个更复杂的`future`

让我们看一下稍微复杂的`future`实现。 在这种情况下，我们将实现一个取得主机名，进行DNS解析，然后建立与远程主机的连接的`future`。 我们假设存在一个如下所示的resolve函数：

```rust
pub fn resolve(host: &str) -> ResolveFuture;
```

其中`ResolveFuture`是一个返回`SocketAddr`的`future`。

实现`future`的步骤是：

1. 调用`resolve`以获取`ResolveFuture`实例。
2. 调用`ResolveFuture::poll`直到它返回一个`SocketAddr`。
3. 将`SocketAddr`传递给`TcpStream :: connect`。
4. 调用`ConnectFuture :: poll`直到它返回`TcpStream`。
5. 使用`TcpStream`完成外部`future`。

我们将使用枚举来跟踪`future`的状态.

```rust
enum State {
    // Currently resolving the host name
    Resolving(ResolveFuture),

    // Establishing a TCP connection to the remote host
    Connecting(ConnectFuture),
}
```

`ResolveAndConnect`的`future`定义为：

```rust
pub struct ResolveAndConnect {
    state: State,
}
```

```rust
pub fn resolve_and_connect(host: &str) -> ResolveAndConnect {
    let state = State::Resolving(resolve(host));
    ResolveAndConnect { state }
}

impl Future for ResolveAndConnect {
    type Item = TcpStream;
    type Error = io::Error;

    fn poll(&mut self) -> Result<Async<TcpStream>, io::Error> {
        use self::State::*;

        loop {
            let addr = match self.state {
                Resolving(ref mut fut) => {
                    try_ready!(fut.poll())
                }
                Connecting(ref mut fut) => {
                    return fut.poll();
                }
            };

            let connecting = TcpStream::connect(&addr);
            self.state = Connecting(connecting);
        }
    }
}
```

这解释了Future如何实现状态机。 这个`future`可以是两种状态中的任何一种：

1. `Resolving`
2. `Connecting`

每次调用`poll`时，我们都会尝试将状态机推进到下一个状态。

现在，我们刚刚实现的`future`基本上是组合器`AndThen`，所以我们可能只是使用该组合器而不是重新实现它。

```rust
resolve(my_host)
    .and_then(|addr| TcpStream::connect(&addr))
```

这个能使完成同样的事情的前提下代码更短．