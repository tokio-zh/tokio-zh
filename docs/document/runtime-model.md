# 运行时模型

现在我们将介绍Tokio /`future`运行时模型。 Tokio构建在`future`顶部并使用其运行时模型。 这允许它也使用`future`与其它库进行相互互操作。

注意：此运行时模型与其他语言中的异步库非常不同。 虽然在较高的层面上，API看起来很相似，但代码执行方式却有所不同。

## 同步模型

首先，让我们简要谈谈同步（或阻塞）模型。 这是Rust标准库使用的模型。

```rust
// let socket = ...;
let mut buf = [0; 1024];
let n = socket.read(&mut buf).unwrap();

// Do something with &buf[..n];
```

调用`socket.read`时，有两种情况，套接字在其缓冲区中有待处理数据，或者没有． 如果有待处理的数据，则`read`的调用将立即返回，并且buf将填充该数据。 然而，如果没有未决数据，则`read`函数将阻塞当前线程，直到收到数据。 此时，buf将填充此新接收的数据，并且将返回`read`函数

为了同时在许多不同的套接字上并发执行读取，每个套接字需要一个线程。 每个套接字使用一个线程不能很好地扩展到大量的套接字。 这被称为[c10k](https://en.wikipedia.org/wiki/C10k_problem)问题。

## 非阻塞套接字

在执行像read这样的操作时避免阻塞线程的方法是不阻塞线程！ 当套接字在其接收缓冲区中没有未决数据时，`read`函数立即返回，表明套接字“未准备好”以执行读取操作。

使用Tokio TcpStream时，即使没有要读取的待处理数据，对read的调用也将返回类型``ErrorKind::WouldBlock``的错误。 此时，调用者负责稍后再次调用read。 诀窍是知道“晚些时候”的时间。

考虑非阻塞读取的另一种方法是“轮询”套接字以读取数据。

## 轮询模型

轮询套接字数据的策略可以推广到任何操作。 例如，在轮询模型中获取“小部件”的函数看起来像这样：

```rust
fn poll_widget() -> Async<Widget> { ... }
```

此函数返回`Async<Widget>`，其中Async是`Read(Widget)`或`NotReady`的枚举。 Async枚举由`future`库提供，是轮询模型的构建块之一。

现在，让我们定义一个没有使用此poll_widget函数的组合器的异步任务。 该任务将执行以下操作：

1. 获取小部件。
2. 将小部件打印到STDOUT。
3. 终止任务。

为了定义任务，我们实现了`Future` trait。

```rust
///轮询单个小部件并将其写入STDOUT的任务。
pub struct MyTask;

impl Future for MyTask {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Result<Async<()>, ()> {
        match poll_widget() {
            Async::Ready(widget) => {
                println!("widget={:?}", widget);
                Ok(Async::Ready(()))
            }
            Async::NotReady => {
                return Ok(Async::NotReady);
            }
        }
    }
}
```

**重要提示：** 返回`Async::NotReady`具有特殊含义。有关详细信息，请参阅下一节。

需要注意的关键是，当调用`MyTask::poll`时，它会立即尝试获取小部件。 如果对`poll_widget`的调用返回`NotReady`，则该任务无法继续进行。 然后任务返回NotReady，表明它尚未准备好完成处理。

任务实现不会阻塞。 相反，“将来的某个时间”，执行者将再次调用``MyTask::poll`。 然后再次调用`poll_widget`。 如果`poll_widget`已准备好返回窗口小部件，则该任务又可以打印窗口小部件。 然后，可以通过返回`Ready`来完成任务。

## 执行者(Executors)

为了使任务取得进展，必须调用`MyTask::poll`。 这就是执行者的工作。

执行者负责反复调用任务轮询，直到返回Ready。 有很多不同的方法可以做到这一点。 例如，[CurrentThread](https://docs.rs/tokio/0.1/tokio/executor/current_thread/index.html)执行者将阻止当前线程并遍历所有生成的任务，并对它们调用poll。 [ThreadPool](http://docs.rs/tokio-threadpool)在线程池中调度任务。 这也是运行时默认使用的执行者。

必须在执行者上生成所有任务，否则不会执行任何工作。

在最简单的情况下，执行者可能看起来像这样：

```rust
pub struct SpinExecutor {
    tasks: VecDeque<Box<Future<Item = (), Error = ()>>>,
}

impl SpinExecutor {
    pub fn spawn<T>(&mut self, task: T)
    where T: Future<Item = (), Error = ()> + 'static
    {
        self.tasks.push_back(Box::new(task));
    }

    pub fn run(&mut self) {
        while let Some(mut task) = self.tasks.pop_front() {
            match task.poll().unwrap() {
                Async::Ready(_) => {}
                Async::NotReady => {
                    self.tasks.push_back(task);
                }
            }
        }
    }
}
```

当然，这不会非常有效。 执行程序在一个繁忙的循环中运转并尝试轮询所有任务，即使任务将再次返回`NotReady`。

理想情况下，执行者可以通过某种方式知道任务的“准备就绪”状态何时被改变，即当`poll`调用返回`Ready`时。 执行者看起来像这样：

```rust
    pub fn run(&mut self) {
        loop {
            while let Some(mut task) = self.ready_tasks.pop_front() {
                match task.poll().unwrap() {
                    Async::Ready(_) => {}
                    Async::NotReady => {
                        self.not_ready_tasks.push_back(task);
                    }
                }
            }

            if self.not_ready_tasks.is_empty() {
                return;
            }

            // Put the thread to sleep until there is work to do
            self.sleep_until_tasks_are_ready();
        }
    }

```

当任务从“未准备好”变为“准备好”时能够得到通知是`future`任务模型的核心。 我们将很快进一步深入研究。