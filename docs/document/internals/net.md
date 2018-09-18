# 非阻塞I/O

本节介绍Tokio提供的网络资源和`drivers`。 这个组件提供Tokio的主要功能之一：非阻塞，事件驱动，由适当的操作系统原语提供的网络（epoll，kqueue，IOCP，...）。 它以资源和驱动程序模式为模型在上一节中描述。

网络`driver`使用[mio]构建，网络资源由后备实现[Evented](https://docs.rs/mio/0.6.16/mio/event/trait.Evented.html)的类型。

本指南将重点介绍TCP类型。 其他网络资源（UDP，unix插座，管道等）遵循相同的模式。

## 网络资源。

网络资源是类型，例如[`TcpListener`]和[`TcpStream`]由网络句柄和对正在供电的[驱动程序]的引用组成资源。 最初，在首次创建资源时，驱动程序指针可能是'None'：

```rust
let listener = TcpListener::bind(&addr).unwrap();
```

在这种情况下，尚未设置对驱动程序的引用。 但是，如果使用带有Handle引用的构造函数，则驱动程序引用将设置为给定句柄表示的驱动程序：

```rust
let listener = TcpListener::from_std(std_listener, &my_reactor_handle);
```