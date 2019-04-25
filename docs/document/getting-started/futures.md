# Futures

让我们仔细看看futures。Tokio构建在`futures`crate 之上并使用其运行时模型。这允许它也使用futures库与其他库互操作。

注意：此运行时模型与其他语言中的异步库非常不同。虽然在较高的层面上，API看起来很相似，但代码执行方式却有所不同。

我们将在下一节中仔细研究运行时，但是对运行时的基本了解是理解`Future`的必要条件。为了获得这种理解，我们首先看一下Rust默认使用的同步模型，看看它与Tokio的异步模型有何不同。

## 同步模型

首先，让我们简要介绍一下Rust 标准库使用的同步（或阻塞）模型。

```rust
// let socket = ...;
let mut buf = [0; 1024];
let n = socket.read(&mut buf).unwrap();

// Do something with &buf[..n];
```

调用`socket.read`时，根据`socket`在其接收缓冲区中是否具有等待处理的数据。 如果有待处理的数据，则read将立即返回，buf将填充该数据。 但是，如果没有未决数据，则read函数将阻止当前线程，直到收到数据。 一旦收到数据，buf将填充这个新接收的数据，并返回读取功能。

为了同时在许多不同的套接字上执行读取，每个套接字需要一个线程。 每个套接字使用一个线程不能很好地扩展到大量的套接字。 这被称为c10k问题。

## 非阻塞套接字

在执行像`read`这样的操作时避免阻塞线程的方法是不阻塞线程！非阻塞套接字允许执行操作，如读取，而不会阻塞线程。当套接字在其接收缓冲区中没有待处理的数据时，read函数立即返回，表明套接字“未准备好”以执行读取操作。

使用`Tokio TcpStream`时，即使没有要读取的待处理数据，对`read`的调用也将立即返回一个值（ErrorKind :: WouldBlock）。如果没有待处理的数据，则调用者负责稍后再次调用`read`。诀窍是知道“晚些时候”的时间。

考虑非阻塞读取的另一种方法是“轮询”套接字以读取数据。

`Future`是围绕这种轮询模型的抽象。`Future`代表将在“未来某个时刻”提供的值。我们可以轮询`Future`并询问值是否准备就绪。我们来看看更多细节。


## 仔细看看期货

`future`是表示异步计算完成的值。通常，由于系统中其他位置发生的事件使`future`完成。虽然我们从基本`I/O`的角度看待事物，但您可以使用`future`来表示各种事件，例如：

* 在线程池中执行的数据库查询。查询完成后，`future`完成，其值是查询的结果。

* 对服务器的RPC调用。当服务器回复时，`future`完成，其值是服务器的响应。

* 超时:当时间到了，`future`就完成了，它的值是（）。

* 在线程池上运行的长时间运行的CPU密集型任务。任务完成后，`future`完成，其值为任务的返回值。

* 从套接字读取字节。当字节准备就绪时，`future`就完成了 - 根据缓冲策略，字节可能直接返回，或作为副作用写入某个现有缓冲区。

`future`抽象的整个要点是允许异步函数，即不能立即返回值的函数，能够返回一些东西。

例如，异步HTTP客户端可以提供如下所示的get函数：

```rust
pub fn get(&self, uri: &str) -> ResponseFuture { ... }
```

然后，库的用户将使用该函数：

```rust
let response_future = client.get("https://www.example.com");
```

现在，`response_future`不是实际响应。 一旦收到回复，这将是一个`future`。 但是，由于调用者具有具体值（`future`），因此他们可以开始使用它。 例如，他们可以使用组合器链接计算，以便在收到响应后执行，或者可以将`future`传递给函数。

```rust
let response_is_ok = response_future
    .map(|response| {
        response.status().is_ok()
    });

track_response_success(response_is_ok);
```

所有与`future`一起采取的行动都不会立即执行任何工作。 他们不能，因为他们没有实际的HTTP响应。 相反，他们定义了响应`future`完成时要完成的工作。

`futures`箱和`Tokio`都有一系列组合功能，可以用来处理`future`。 到目前为止，我们已经看到`and_then`将两个`future`链接在一起，然后允许将`future`链接到前一个，即使前一个错误，映射只是将`future`的值从一种类型映射到另一种类型。

我们将在本指南后面探索更多的组合器。


## 基于轮询模型的`Future`

如前所述，Rust`Future`基于轮询模型。 这意味着， Future一旦完成后，它不会负责将数据推送到某个地方，而是依赖于被询问它是否完成。

这是Rust`futures`库的一个独特方面。 其他编程语言的大多数`Future`库使用基于推送的模型，其中回调被提供给`Future`，并且计算立即使用计算结果调用回调。

使用基于轮询的模型提供了许多优点，包括作为零成本抽象，即与手动编写异步代码相比，使用Rust`Future`没有额外的开销。

我们将在下一节中仔细研究这种基于民意调查的模型。

## The Future trait

`Future`的特点如下：

```rust
trait Future {
    /// The type of the value returned when the future completes.
    type Item;

    /// The type representing errors that occurred while processing the computation.
    type Error;

    /// The function that will be repeatedly called to see if the future is
    /// has completed or not
    fn poll(&mut self) -> Result<Async<Self::Item>, Self::Error>;
}
```

现在，了解`Future`有两种相关类型非常重要： `Item`和`Error`。 `Item`是`Future`在完成时将产生的值的类型。 错误是如果在导致`Future`能够完成之前出现错误，`Future`可能会产生的错误类型。

最后，Futures有一种名为`poll`的方法。 我们不会在本节中详细介绍轮询模型，因为您不需要了解有关使用组合器的`Future`的轮询模型。 现在唯一需要注意的是，`poll`是在`tokio`运行时调用的，以便查看Future是否已完成。 如果你很好奇：Async是一个带有值的枚举，Ready(Item)或者NotReady告诉`tokio`运行时`Future`是否完成。

在以后的部分中，我们将从头开始实现`Future`，包括编写一个`poll`函数，该函数在`Future`完成时正确通知`tokio`运行时。
