# 组合器

Future 的实现往往遵循相同的模式。为了减少重复代码，`future` 库提供了许多被称为 “组合器（Combinator）” 的工具，它们是这些模式的抽象，多以 [`Future`] 特质相关的函数的形式存在。

## 基础构件

让我们回顾之前几页中的 future 实现，看看怎么用组合器去简化它们。

### `map`

[`map`] 组合器拥有一个 future 并返回一个新 future，新 future 的值是通过前一个 future 调用某个给定的函数获得的。

这是之前实现的 future `Display`：

```rust
impl<T> Future for Display<T>
where
    T: Future,
    T::Item: fmt::Display,
{
    type Item = ();
    type Error = T::Error;

    fn poll(&mut self) -> Poll<(), T::Error> {
        let value = try_ready!(self.0.poll());
        println!("{}", value);
        Ok(Async::Ready(()))
    }
}

fn main() {
    let future = Display(HelloWorld);
    tokio::run(future);
}
```

如果用 `map` 组合器来写的话，就是这样的:

```rust
extern crate tokio;
extern crate futures;

use futures::Future;

fn main() {
    let future = HelloWorld.map(|value| {
        println!("{}", value);
    });

    tokio::run(future);
}
```

下面是 `map` 的实现:

```rust
pub struct Map<A, F> where A: Future {
    future: A,
    f: Option<F>,
}

impl<U, A, F> Future for Map<A, F>
    where A: Future,
          F: FnOnce(A::Item) -> U,
{
    type Item = U;
    type Error = A::Error;

    fn poll(&mut self) -> Poll<U, A::Error> {
        let value = try_ready!(self.future.poll());
        let f = self.f.take().expect("cannot poll Map twice");

        Ok(Async::Ready(f(value)))
    }
}
```
把 `Map` 和我们的 `Display` 放在一起比较，就可以明显看出它们的相似性。`Map` 在 `Display` 调用 `println!` 的相同位置把值传给了给定的函数。

### `and_then`

现在，让我们开始用 `and_then` 组合器重写建立TCP流以及写入 “hello world” 的 future。

`and_then` 组合器允许我们将两个异步操作连接起来。在第一个操作完成时，其值将被传递到一个函数中。该函数会使用该值创建一个新的 future 并使其运行。 `and_then` 和 `map` 的区别是 `and_then` 的函数返回一个 future，而 `map` 的函数返回一个值。

最初的实现在 [这里][connect-and-write]。用组合器重写的话，就是这样的:

```rust
extern crate tokio;
extern crate bytes;
extern crate futures;

use tokio::io;
use tokio::net::TcpStream;
use futures::Future;

fn main() {
    let addr = "127.0.0.1:1234".parse().unwrap();

    let future = TcpStream::connect(&addr)
        .and_then(|socket| {
            io::write_all(socket, b"hello world")
        })
        .map(|_| println!("write complete"))
        .map_err(|_| println!("failed"));

    tokio::run(future);
}
```

进一步的计算也可以用链式调用 `and_then` 来连接。比如：

```rust

fn main() {
    let addr = "127.0.0.1:1234".parse().unwrap();

    let future = TcpStream::connect(&addr)
        .and_then(|socket| {
            io::write_all(socket, b"hello world")
        })
        .and_then(|(socket, _)| {
            // 只读取11个字节
            io::read_exact(socket, vec![0; 11])
        })
        .and_then(|(socket, buf)| {
            println!("got {:?}", buf);
            Ok(())
        });

    tokio::run(future);
}
```

`and_then` 返回的 future 会像我们在之前手动实现的 future 那样执行。

## 基本组合器

花时间看一下 [`Future` 特质][trait-dox] 和其 [模块][mod-dox] 的文档来熟悉所有可用的组合器是很值得的。本文仅提供快速简要的概述。

[trait-dox]: https://docs.rs/futures/0.1/futures/future/trait.Future.html
[mod-dox]: https://docs.rs/futures/0.1/futures/future/index.html

### 既定的 future

任何值都可以立即生成一个已完成的 future。`future` 模块中有一些用于创建该类 future 的函数：

- [`ok`]，对应 `Result::Ok`，可以将给定值转化为一个立即就绪的 future，该 future 可以用于生成原值。

- [`err`]，对应 `Result::Err`，可以将给定错误转化为一个立即就绪的失败的 future，该 future 所包含的错误即原错误。

- [`result`] 将一个结果转化为一个立即完成的 future（译者注：`Result::Ok` 或者 `Result::Err` 都是可以的）。

[`ok`]: https://docs.rs/futures/0.1/futures/future/fn.ok.html
[`err`]: https://docs.rs/futures/0.1/futures/future/fn.err.html
[`result`]: https://docs.rs/futures/0.1/futures/future/fn.result.html

另外，还有一个 [`lazy`] 函数，允许我们通过一个 *闭包* 来构建一个 future。这个闭包不会被立即调用，而是在 future 第一次被拉取时调用。

[`lazy`]: https://docs.rs/futures/0.1/futures/future/fn.lazy.html

### `IntoFuture` 特质

[`IntoFuture`] 特质是一个很关键的 API，它代表各种可以被转化为 future 的值。大多数使用 future 的接口实际上是用它实现的。原因在于：`Result` 实现了这个特质，这就允许我们在很多需要返回 future 的地方直接返回 `Result` 值。

大多数返回 future 的组合器闭包实际上返回的也是一个 [`IntoFuture`] 实例。

[`IntoFuture`]: https://docs.rs/futures/0.1/futures/future/trait.IntoFuture.html

### 适配器

就像 [`Iterator`] 那样，`Future` 特质也包含了各种各样的“适配器”方法。 这些方法消费当前 future，返回一个新的 future 以提供我们请求的行为。使用这些适配组合器，我们可以：

* 改变一个 future 的类型 ([`map`], [`map_err`])
* 在一个 future 完成时执行另一个 ([`then`], [`and_then`],
  [`or_else`])
* 找出两个 future 中哪个先执行完成 ([`select`])
* 等待两个 future 都完成 ([`join`])
* 转化为一个特质对象 ([`Box::new`])
* 将展开式恐慌转化为错误 ([`catch_unwind`])

[`Iterator`]: https://doc.rust-lang.org/std/iter/trait.Iterator.html
[`Box`]: https://doc.rust-lang.org/std/boxed/struct.Box.html
[`Box::new`]: https://doc.rust-lang.org/std/boxed/struct.Box.html#method.new
[`map`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.map
[`map_err`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.map_err
[`then`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.then
[`and_then`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.and_then
[`or_else`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.or_else
[`select`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.select
[`join`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.join
[`catch_unwind`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.catch_unwind

## 何时使用组合器

使用组合器可以减少陈词滥调，但它们并不总那么合适。由于某些限制，手动实现 `Future` 可能更为常见。

### 函数式风格

传递给组合器的闭包必须是 `'static` 的。这就意味着不可能在闭包中加入引用。所有状态的所有权必须被转移到闭包中。这是因为 Rust 的生命周期是基于栈的。使用异步代码，就意味着失去了栈的相关功能。

也正因为如此，使用组合器就会写出函数式风格的代码。让我们比较一下 Future 组合器和异步的 `Result` 组合器。

```rust
use std::io;

fn get_data() -> Result<Data, io::Error> {
    // ...
}

fn get_ok_data() -> Result<Vec<Data>, io::Error> {
    let mut dst = vec![];

    for _ in 0..10 {
        get_data().and_then(|data| {
            dst.push(data);
            Ok(())
        });
    }

    Ok(dst)
}
```
上面的代码可以工作是因为传递给 `and_then` 的闭包可以获取到 `dst` 的可变借用。Rust 编译器可以保证 `dst` 存活的比闭包更久。

然而使用 future 的话，借用 `dst` 就行不通了，必须改为传递 `dst`。像这样：

```rust
extern crate futures;

use futures::{stream, Future, Stream};
use std::io;

fn get_data() -> impl Future<Item = Data, Error = io::Error> {
    // ...
}

fn get_ok_data() -> impl Future<Item = Vec<Data>, Error = io::Error> {
    let mut dst = vec![];

    // Start with an unbounded stream that uses unit values.
    stream::repeat(())
        // Only take 10. This is how the for loop is simulated using a functional
        // style.
        .take(10)
        // The `fold` combinator is used here because, in order to be
        // functional, the state must be moved into the combinator. In this
        // case, the state is the `dst` vector.
        .fold(dst, move |mut dst, _| {
            // Once again, the `dst` vector must be moved into the nested
            // closure.
            get_data().and_then(move |item| {
                dst.push(item);

                // The state must be included as part of the return value, so
                // `dst` is returned.
                Ok(dst)
            })
        })
}
```

还有一种策略，可以配合不可变数据使用，将数据存储在一个 `Arc` 中，然后将句柄的拷贝放到闭包中。有一种比较适用的场景就是将配置值在多个闭包中共享。比如：

```rust
extern crate futures;

use futures::{future, Future};
use std::io;
use std::sync::Arc;

fn get_message() -> impl Future<Item = String, Error = io::Error> {
    // ....
}

fn print_multi() -> impl Future<Item = (), Error = io::Error> {
    let name = Arc::new("carl".to_string());

    let futures: Vec<_> = (0..1).map(|_| {
        // 拷贝 `name` 句柄, 这样依赖多个并发的 future 都可以打印这个 `name` 值。
        let name = name.clone();

        get_message()
            .and_then(move |message| {
                println!("Hello {}, {}", name, message);
                Ok(())
            })
    })
    .collect();

    future::join_all(futures)
        .map(|_| ())
}
```

### 返回 future

因为组合器经常使用闭包作为它们类型签名的一部分，future 的类型是无法确定的。这就造成 future 的类型无法作为函数签名的一部分。当使用一个 future 作为函数参数时，泛型可以自由运用于几乎所有情况。例如：

```rust
extern crate futures;

use futures::Future;

fn get_message() -> impl Future<Item = String> {
    // ...
}

fn with_future<T: Future<Item = String>>(f: T) {
    // ...
}

let my_future = get_message().map(|message| {
    format!("MESSAGE = {}", message)
});

with_future(my_future);
```

但是当函数返回 future 的时候，就没有这么简单了。这里是一些各有利弊的可选方法:

* [使用 `impl Future`](#use-impl-future)
* [特质对象](#trait-objects)
* [手动实现 `Future`](#implement-future-by-hand)

#### 使用 `impl Future`

从 Rust 的 **1.26** 版本开始，[`impl Trait`] 这一语言特性就可以用来返回组合器 future 了。因此我们可以这样写:

[`impl Trait`]: https://github.com/rust-lang/rfcs/blob/master/text/1522-conservative-impl-trait.md

```rust
fn add_10<F>(f: F) -> impl Future<Item = i32, Error = F::Error>
    where F: Future<Item = i32>,
{
    f.map(|i| i + 10)
}
```

`add_10` 函数的返回值类型是“某个实现了`Future`特质的类型”，它还附带类一些相关类型。这就允许我们不需要显式制定 future 的类型而直接返回一个 future。

这种方法的优点是它零开销并且适用于各种各样的情况。但是，使用这种方法从不同代码分支返回 future 的时候可能会有一个问题。例如:

```rust
if some_condition {
    return get_message()
        .map(|message| format!("MESSAGE = {}", message));
} else {
    return futures::ok("My MESSAGE".to_string());
}
```

##### 从多个代码分支返回

以上代码会导致 `rustc` 输出编译错误：`error[E0308]: if and else have incompatible types`（if 和 else 存在不匹配的类型）。也就是说返回 `impl Future` 的函数还是必须有一个唯一确定的返回类型。`impl Future` 语法只是允许我们不明确指定类型。然而，每个组合器类型都有一个**不同**的类型，这就造成各个条件分支中的返回类型不同。对于以上情况，我们有两种解决方案。第一种时将函数的返回值改为一个 [特质对象](#trait-objects)。第二种方法是使用 [`Either`] 类型：

```rust
if some_condition {
    return Either::A(get_message()
        .map(|message| format!("MESSAGE = {}", message)));
} else {
    return Either::B(
        future::ok("My MESSAGE".to_string()));
}
```

这就确保了函数有唯一的返回值类型: `Either`.

在多于两个分支的时候，`Either`枚举必须嵌套使用（`Either<Either<A, B>, C>`）或者自行定制一个支持多变量的枚举类型。

这种方案经常用于按条件返回错误的情况。比如：

```rust
fn my_operation(arg: String) -> impl Future<Item = String> {
    if is_valid(&arg) {
        return Either::A(get_message().map(|message| {
            format!("MESSAGE = {}", message)
        }));
    }

    Either::B(future::err("something went wrong"))
}
```
要在遇到错误时提前返回，必须把错误放到一个 `Either` 变量中。

[`Either`]: https://docs.rs/futures/0.1.25/futures/future/enum.Either.html

##### 相关类型

具有返回 future 的函数的特质一定会包含 future 相关的类型定义。比如，我们来看一个简化版本的 Tower 库中的 [`Service`] 特质：

```rust
pub trait Service {
    /// Requests handled by the service.
    type Request;

    /// Responses given by the service.
    type Response;

    /// Errors produced by the service.
    type Error;

    /// The future response value.
    type Future: Future<Item = Self::Response, Error = Self::Error>;

    fn call(&mut self, req: Self::Request) -> Self::Future;
}
```

为了实现这个特质，`call` 函数返回的 future 必须被明确指定并被设置为 `Future` 的相关类型。在这种情况下，`impl Future` 就不能用了，我们必须把 future 装箱为一个 [特质对象](#trait-objects)，或者自己定制一个future。

[`Service`]: https://docs.rs/tower-service/0.1/tower_service/trait.Service.html

#### 特质对象（Trait objects）

还有一种策略是返回一个装箱的 future，即一个 [特质对象]：

```rust
fn foo() -> Box<Future<Item = u32, Error = io::Error> + Send> {
    // ...
}
```

这种策略的优点是 `Box` 非常易于使用。我们还可以处理之前所述的分支问题，并且任意多个分支都可以：

```rust
fn my_operation(arg: String) -> Box<Future<Item = String, Error = &'static str> + Send> {
    if is_valid(&arg) {
        if arg == "foo" {
            return Box::new(get_message().map(|message| {
                format!("FOO = {}", message)
            }));
        } else {
            return Box::new(get_message().map(|message| {
                format!("MESSAGE = {}", message)
            }));
        }
    }

    Box::new(future::err("something went wrong"))
}
```

这种方法的缺点是装箱会产生更多的开销。储存返回的 future 值会带来一次内存分配。并且，无论什么时候使用这个 future，Rust 都需要通过一次运行时查找（vtable；虚表）来动态地拆箱。这会使装箱的 future 在实际运行时稍微慢一些，尽管这种差异往往并不显著。

有一个附加说明可以帮作者们尝试使用 `Box<Future<...>>`，特别是跟 `tokio::run` 一同使用。默认情况下，`Box<Future<...>>` **没有** 实现 `Send` 特质，无法跨线程发送，即使内部装箱的 future 实现了 `Send` 特质。

想确保一个装箱的 future 实现 `Send` 特质, 必须这样写:

```rust
fn my_operation() -> Box<Future<Item = String, Error = &'static str> + Send> {
    // ...
}
```

[trait object]: https://doc.rust-lang.org/book/trait-objects.html

#### 手动实现 `Future`

最后，当所有以上策略都失败时，我们还是可以退回到手动实现 `Future` 的方法。手动实现可以提供完整的控制，但是因为没有组合器函数能用于这种方法，我们得花更多的精力在那些陈词滥调上了。

### 何时使用组合器

在你基于 Tokio 的应用程序中，组合器是减少重复代码的有力解决方案，但是就如本章节所述，它们并不是“银弹”。实现定制的future和定制的组合器还是很常见的。这就提出了什么时候使用组合器与手动实现 `Future` 的选择问题。

根据上述探讨，如果 future 的类型必须被指明并且`Box`是不可接受的开销，那么我们就可以不用组合器。除了这一点，选择什么还取决于组合器间传递的状态的复杂性。

“状态必须从多个组合器并发访问”可能是手动实现 `Future` 的一个适用场景。

待完善（TODO）: 本章节需要更多的例子。如果你有改善本章节的好点子，可以访问 [doc-push] 库并以你的想法创建一个问题。

[doc-push]: https://github.com/tokio-rs/doc-push
[`map`]: https://docs.rs/futures/0.1/futures/future/trait.Future.html#method.map
