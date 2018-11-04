# 运行时

在上一节中，我们探讨了`Futures`和`Streams`，它们允许我们表示一个值（在Future的情况下）或一系列值（在Stream的情况下）将在“未来的某个时刻”可用。 我们讨论了关于Future和Stream的轮询，运行时将调用它来确定Future或Stream是否已准备好产生值。

最后，我们说需要运行时来轮询`Future`和`Streams`来推动它们完成。 我们现在将仔细研究运行时。

## Tokio runtime

为了让`Future`取得进步，必须要调用`poll`。 这是运行时的工作。

运行时负责重复调用`Future`上的`poll`，直到返回其值。 有许多不同的方法可以做到这一点，因此有许多类型的运行时配置。 例如，[`CurrentThread`](https://docs.rs/tokio/0.1/tokio/executor/current_thread/index.html)运行时配置将阻止当前线程并循环遍历所有生成的Futures，并对它们调用poll。 [`ThreadPool`](https://docs.rs/tokio-threadpool/0.1.8/tokio_threadpool/)配置在线程池中安排Futures。 这也是Tokio运行时使用的默认配置。

重要的是要记住，所有`Future`必须在运行时生成，否则不会执行任何工作。

## 产生任务

Tokio的一个独特方面是`Future`可以在运行时从其他`Future`或流中产生。当我们以这种方式使用`Future`时，我们通常将它们称为任务。任务是应用程序的“逻辑单元”。它们类似于[Go的goroutine]和[Erlang的过程]，但是异步。换句话说，任务是异步绿色线程。

鉴于任务运行异步逻辑位，它们由Future特征表示。任务完成处理后，任务的`Future`实现将以（）值完成。

任务被传递到运行时，它处理任务的调度。运行时通常在一个或一组线程中调度许多任务。任务不得执行计算量大的逻辑，否则会阻止其他任务执行。因此，不要尝试将斐波那契序列计算为任务！

任务通过使用`Future`和`Tokio`中可用的各种组合函数或通过直接实现Tokio特征来构建Tokio来实现。

我们可以使用`tokio :: spawn`生成任务。例如：

```rust
// Create some kind of future that we want our runtime to execute
let program = my_outer_stream.for_each(|my_outer_value| {
  println!("Got value {:?} from the stream", my_outer_value);
  # let my_inner_future = future::ok(1);

  let task = my_inner_future.and_then(|my_inner_value| {
    println!("Got a value {:?} from second future", my_inner_value);
    Ok(())
  });

  tokio::spawn(task);
  Ok(())
});

tokio::run(program);
```

再次产生任务可以在其他`Future`或流中产生，允许多个事物同时产生。 在上面的例子中，我们从外部流中产生了内在的`Future`。 每当我们从流中获得一个值时，我们就会简单地运行内在的`Future`。

在下一节中，我们将看一个比我们的hello-world示例更为复杂的示例，该示例将我们迄今为止所学到的所有内容都考虑在内。
