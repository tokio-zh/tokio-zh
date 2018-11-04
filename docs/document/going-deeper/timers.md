# Timers

在编写基于网络的应用程序时，通常需要根据时间执行操作。

* 在一段时间后运行一些代码。
* 取消运行时间过长的运行操作。
* 以一定间隔重复执行操作。

这些用例通过使用计时器模块中提供的各种计时器API来处理。

## 一段时间后运行代码

在这种情况下，我们希望在一段时间后执行任务。 为此，我们使用Delay API。 我们要做的就是写“Hello world！” 到终端，但此时可以采取任何行动。

```rust
use tokio::prelude::*;
use tokio::timer::Delay;

use std::time::{Duration, Instant};

fn main() {
    let when = Instant::now() + Duration::from_millis(100);
    let task = Delay::new(when)
        .and_then(|_| {
            println!("Hello world!");
            Ok(())
        })
        .map_err(|e| panic!("delay errored; err={:?}", e));

    tokio::run(task);
}
```

上面的示例创建了一个新的Delay实例，该实例将在`future`100毫秒内完成。 新函数需要一个Instant，所以我们计算从现在起100毫秒的瞬间。

到达瞬间后，延迟`future`完成，从而导致执行and_then块。

与所有`future`一样，延迟是懒惰的。 简单地创建一个新的Delay实例什么都不做。 该实例必须用于生成到Tokio运行时的任务。 运行时预先配置了一个计时器实现，以驱动Delay实例完成。 在上面的示例中，这是通过将任务传递给tokio :: run来完成的。 使用tokio :: spawn也可以。

## 计时耗时操作

在编写健壮的网络应用程序时，确保在合理的时间内完成操作至关重要。 在等待来自外部，可能不受信任的来源的数据时尤其如此。

Timeout类型确保操作在指定的时刻完成。

```rust
use tokio::io;
use tokio::net::TcpStream;
use tokio::prelude::*;

use std::time::{Duration, Instant};

fn read_four_bytes(socket: TcpStream)
    -> Box<Future<Item = (TcpStream, Vec<u8>), Error = ()>>
{
    let buf = vec![0; 4];
    let fut = io::read_exact(socket, buf)
        .timeout(Duration::from_secs(5))
        .map_err(|_| println!("failed to read 4 bytes by timeout"));

    Box::new(fut)
}
```

上面的函数接受一个套接字并返回一个从套接字读取4个字节后完成的`future`。 读取必须在5秒内完成。 通过在读取`future`上调用超时来确保这一点，持续时间为5秒。

超时函数由FutureExt定义，包含在前奏中。 因此，使用tokio :: prelude :: *也会导入FutureExt，因此我们可以在所有`future`上调用超时，以便要求它们在指定的瞬间完成。

如果在没有读取完成的情况下达到超时，则自动取消读取操作。 当io :: read_exact返回的`future`被删除时会发生这种情况。 由于延迟的运行时模型，删除`future`会导致操作被取消。

## 在间隔时间段上运行代码

在一个时间间隔内重复运行代码对于在套接字上发送PING消息或经常检查配置文件等情况很有用。 这可以通过重复创建延迟值来实现。 但是，因为这是一种常见模式，所以提供了Interval。

`Interval`类型实现Stream，以指定的速率产生。

```rust
use tokio::prelude::*;
use tokio::timer::Interval;

use std::time::{Duration, Instant};

fn main() {
    let task = Interval::new(Instant::now(), Duration::from_millis(100))
        .take(10)
        .for_each(|instant| {
            println!("fire; instant={:?}", instant);
            Ok(())
        })
        .map_err(|e| panic!("interval errored; err={:?}", e));

    tokio::run(task);
}
```

上面的例子创建了一个Interval，从现在开始每100毫秒产生一次（第一个参数是Interval应该首先触发的瞬间）。

默认情况下，即时流是无界的，即它将永久地以请求的间隔继续产生。 该示例使用Stream :: take来限制Interval产生的次数，此处限制为10个事件的序列。 因此，该示例将运行0.9秒，因为立即生成10个值中的第一个。

## 计时器的注意事项

Tokio计时器的粒度为1毫秒。 任何较小的间隔都会向上舍入到最接近的毫秒。 定时器在用户域中实现（即，不使用像linux上的timerfd这样的操作系统定时器）。 它使用分层散列计时器轮实现，在创建，取消和触发超时时提供有效的恒定时间复杂度。

Tokio运行时包括每个工作线程一个计时器实例。 这意味着，如果运行时启动4个工作线程，则将有4个计时器实例。 这允许在大多数情况下避免同步，因为当使用计时器时，任务将在位于当前线程上的状态下操作。

也就是说，计时器实现是线程安全的，并支持从任何线程使用。