# 新的Tokio版本，现在支持文件系统

它花了比我最初希望的更长的时间（一如既往），但是新的
Tokio版本已经发布。此版本包括其他功能，a
新的[API集] [fs]允许从一个执行文件系统操作
异步上下文。

## Filesystem API

与文件（和其他文件系统类型）交互需要\ *阻塞系统
调用，我们都知道阻塞和异步不混合。所以，
从历史上看，当人们问“我如何读取和写入文件？”时，
答案是使用线程池。这个想法是，当阻止读取或
必须执行write，它是在线程池上完成的，因此它不会阻塞
异步反应堆。

需要单独的线程池来执行文件操作需要消息
通过。异步任务必须向线程池发送消息，询问它
要从文件中读取，线程池会执行读取并填充缓冲区
结果。然后线程池将缓冲区发送回异步
任务。这不仅增加了调度消息的开销，而且还增加了
需要分配缓冲区来回发送数据。

现在，使用Tokio的新[filesystem APIs] [fs]，这个消息传递开销是没有的
需要更久。添加了一个新的[`File`]类型。这种类型看起来非常相似
由`std`提供的类型，但它实现了`AsyncRead`和`AsyncWrite`
直接使用*来自在Tokio上运行的异步任务是安全的
运行。

因为[`File`]类型实现了'AsyncRead`和`AsyncWrite`，所以它可以
使用的方式与从Tokio使用TCP套接字的方式大致相同。

截至今天，文件系统API非常简单。还有许多其他API
需要实现以使Tokio文件系统API符合
`std`，但这些留给读者作为PRs提交的练习！

\ *是的，有一些操作系统提供完全异步
文件系统API，但这些API不完整或不可移植。

## 标准进出

此版本的Tokio还包括异步[标准输入] [in]和
[标准输出] [out] API。因为很难提供真实的
Tokio版本使用便携式方式的异步标准输入和输出
与阻止文件操作API类似的策略。

## `阻止`

由于允许使用新的[`bl​​ocking`] API，这些新API成为可能
注释将阻止当前线程的代码段。这些阻塞
部分可以包括阻止系统调用，等待互斥锁或CPU繁重
计算。

通过告知Tokio运行时当前线程将阻塞运行时
能够将事件循环从当前线程移动到另一个线程，
释放当前线程以允许阻塞。

这与使用消息传递在a上运行阻塞操作相反
线程池。而不是将阻塞操作移动到另一个线程，
整个事件循环被移动。

实际上，将事件循环移动到另一个线程比移动便宜得多
阻止操作。这样做只需要几个原子操作。该
Tokio运行时还保持备用线程池准备好允许移动
事件循环尽可能快。

这也意味着必须使用`blocking`注释和`tokio-fs`
来自Tokio运行时的上下文而不是其他期货感知执行者。

## 当前线程运行时

该版本还包括运行时的[“当前线程”] [rt]版本
（感谢[kpp]（https://github.com/kpp））。这类似于现有的运行时，
但是在当前线程上运行所有组件。这允许运行期货
不要实现[`Send`]。

[fs]: https://docs.rs/tokio/0.1/tokio/fs/index.html
[`File`]: https://docs.rs/tokio/0.1/tokio/fs/struct.File.html
[in]: https://docs.rs/tokio/0.1/tokio/io/fn.stdin.html
[out]: https://docs.rs/tokio/0.1/tokio/io/fn.stdout.html
[`blocking`]: https://docs.rs/tokio-threadpool/0.1/tokio_threadpool/fn.blocking.html
[rt]: https://docs.rs/tokio/0.1/tokio/runtime/current_thread/index.html
