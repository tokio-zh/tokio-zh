# 基础组合器

我们在`future`和`streams`概述中看到了一些最重要的组合。 在这里，我们将再看一些。 值得花一些时间使用特质文档来熟悉可用的全系列组合器（[cheatsheet](https://tokio.rs/img/diagrams/cheatsheet-for-futures.html)）。

## 一些具体的`future`和`streams`

任何价值都可以变成一个立即完整的`future`。 `future`模块中有一些功能可用于创建这样的`future`：

* [ok](https://docs.rs/futures/0.1/futures/future/fn.ok.html)，这类似于`Result :: Ok`：它将你给它的值视为一个立即成功的`future`。
* [err](https://docs.rs/futures/0.1/futures/future/fn.err.html)，类似于`Result :: Err`：它将您提供的值视为立即失败的`future`。
* [result](https://docs.rs/futures/0.1/futures/future/fn.result.html)，将结果提升到一个立即完整的`future`。

对于流，有一些“立即就绪”的流：

* [iter](https://docs.rs/futures/0.1/futures/stream/fn.iter.html)，它创建一个流，产生与底层迭代器相同的项。 迭代器生成Result值，第一个错误终止带有该错误的流。
* once[](https://docs.rs/futures/0.1/futures/stream/fn.once.html)，从结果中创建单元素流。

除了这些构造函数之外，还有一个函数，lazy，它允许您构建一个`future`，给出一个闭包，以便在以后按需生成该`future`。

## IntoFuture

要了解的关键API是IntoFuture trait，它是可以转换为`future`的价值的 trait。 您认为采取`future`的大多数API实际上都适用于此 trait。 关键原因： trait是为Result实现的，允许您在预期`future`的许多地方返回结果值。

## 适配器

与Iterator一样，Future，Stream和`Sink` trait都配备了广泛的“适配器”方法。这些方法都使用接收对象并返回一个新的包装对象。对于`future`，您可以使用适配器：

* 更改`future`的类型（map，map_err）
* 一个完成后运行另一个`future`（then，and_then，or_else）
* 弄清楚两个`future`中的哪一个先解决（select）
* 等两个`future`都完成（join）
* 转换为`trait object`（Box :: new）
* 将展开转换为错误（catch_unwind）

对于流，有一大组适配器，包括：

* 许多与Iterator有共同点，如map，fold，collect，filter，zip，take，skip等。请注意`fold`和`collect`产生`future`，因此它们的结果是异步计算的。
* 用`future`排序的适配器（then，and_then，or_else）
* 用于组合流的附加适配器（merge, select）

`Sink` trait目前具有较少的适配器

最后，可以使用拆分适配器将既是流又是接收器的对象分解为单独的流和接收对象。

所有适配器都是零成本的，这意味着内部没有内存分配，并且实现将优化到您手动编写的内容。

## 错误处理

`future`，`streams`和`sinks`都将错误处理视为核心问题：它们都配备了相关的错误类型，并且各种适配器方法以合理的方式解释错误。例如：

* 序列组合器: then，and_then，or_else，map和map_err所有链错误类似于标准库中的Result类型。因此，例如，如果您使用and_then链接`future`并且第一个`future`因错误而失败，那么链式`future`永远不会运行。

* 像select和join这样的组合也可以处理错误。对于select，以任何方式完成的第一个`future`会产生一个答案，传播错误，但如果你想继续使用它，还可以访问另一个`future`。对于join，如果任何将来产生错误，则整个连接会产生该错误。

默认情况下，`future`对恐慌没有任何特殊处理。但是，在大多数情况下，`future`最终作为线程池中的任务运行，您需要捕获它们产生的任何恐慌并将其传播到其他地方。 catch_unwind适配器可用于在不关闭工作线程的情况下将恐慌重新引入`Result`。