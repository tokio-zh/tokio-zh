# Tokio 0.1.8有许多增量改进

它花了比我最初希望的更长的时间（一如既往），但是新的
Tokio版本已经发布。此版本包括其他功能，a
新的[API集] [fs]允许从一个执行文件系统操作
异步上下文，并发改进，计时器改进等
（包括错误修复，所以一定要更新！）。

自上一篇文章以来已经有点了。没有什么大事
功能发布，但这并不意味着我们已经闲置。新的板条箱有
在过去的几个月中，已经发布了许多渐进式的改进。许多
这些改进是由社区贡献的，所以我想了一个
小亮点是有序的。

## Filesystem API

`tokio-fs`的初始版本更像是一个存根，而不是一个完整的实现。
它只包括基本的文件系统操作。

最新版本包括大多数文件系统的[非阻塞版本] [fs]
蜜蜂。这个惊人的作品主要是由[@griff]在[史诗公关] [公关]中提供的。
和[@lnicola]在一系列较小的公关中，但许多其他人参与了帮助
审查并改进箱子。

谢谢：[@ dekellum]，[@ matsadler]，[@ debris]，[@ mati865]，[@ lovebug356]，
[@bryanburgers]，[@ shepmaster]。

[fs]: https：//docs.rs/tokio/0.1.8/tokio/fs/index.html
[pr]: https：//github.com/tokio-rs/tokio/pull/494

## 并发改进

在过去的几个月里，[@stjepang]一直在努力改善
与Tokio相关的并发比特。一些亮点：

* [#459] - 修复线程唤醒中的竞争
* [#470] - 改善工人纺纱
* [#517] - 提高反应堆中使用的RW锁的可扩展性。
* [#534] - 改进工作窃取运行时的窃取部分。

我在城里为Rustconf做了很好的聊天，我很兴奋
他的工作尚未到来。

当然，感谢所有[crossbeam]的工作。 Tokio在很大程度上取决于它。

## `current_thread :: Runtime`

`current_thread :: Runtime`也收到了一些增量
因为它最初是由[@vorner]和[@kpp]引入的。

[@sdroege]添加了一个`Handle`，允许将生成任务生成到运行时
其他线程（[＃340]）。这是使用通道将任务发送到的
运行时线程（类似'tokio-core`使用的策略）。

并且[@jonhoo]实现了`block_on_all`函数（[＃477]）并修复了一个错误
跟踪活跃期货的数量并协调关闭（[＃478]）

## 计时器改进

`tokio :: timer`确实得到了一个新功能：[`DelayQueue`]。这种类型允许用户
存储一段时间后返回的值。这很有用
用于支持更复杂的时间相关案例。

让我们以缓存为例。缓存的目标是保存值
在一定时间内与密钥相关联。经过一段时间后，
价值下降。一直有可能实现这一点
[`tokio :: timer :: Delay`] [延迟]，但有点挑战。当缓存有很多
必须扫描所有条目以检查是否需要删除它们。

使用[`DelayQueue`]，实现变得更有效：

[`DelayQueue`]: https://docs.rs/tokio-timer/0.2.6/tokio_timer/struct.DelayQueue.html
[Delay]: https://docs.rs/tokio-timer/0.2.6/tokio_timer/struct.Delay.html

```rust
#[macro_use]
extern crate futures;
extern crate tokio;
use tokio::timer::{delay_queue, DelayQueue, Error};
use futures::{Async, Poll, Stream};
use std::collections::HashMap;
use std::time::Duration;

struct Cache {
    entries: HashMap<CacheKey, (Value, delay_queue::Key)>,
    expirations: DelayQueue<CacheKey>,
}

const TTL_SECS: u64 = 30;

impl Cache {
    fn insert(&mut self, key: CacheKey, value: Value) {
        let delay = self.expirations
            .insert(key.clone(), Duration::from_secs(TTL_SECS));

        self.entries.insert(key, (value, delay));
    }

    fn get(&self, key: &CacheKey) -> Option<&Value> {
        self.entries.get(key)
            .map(|&(ref v, _)| v)
    }

    fn remove(&mut self, key: &CacheKey) {
        if let Some((_, cache_key)) = self.entries.remove(key) {
            self.expirations.remove(&cache_key);
        }
    }

    fn poll_purge(&mut self) -> Poll<(), Error> {
        while let Some(entry) = try_ready!(self.expirations.poll()) {
            self.entries.remove(entry.get_ref());
        }

        Ok(Async::Ready(()))
    }
}
```

## Many other small improvements

除了上面列出的内容之外，Tokio还获得了许多小改进
并修复了大多数板条箱的错误。 这些都是由我们惊人的提供
社区。 我希望随着时间的推移，越来越多的人会加入这项努力
建立Tokio并帮助它继续发展。

所以，非常感谢[你们所有人]迄今为止对Tokio贡献。

[你们所有人]: https://github.com/tokio-rs/tokio/graphs/contributors
[crossbeam]: https://github.com/crossbeam-rs/
[@dekellum]: https://github.com/dekellum
[@matsadler]: https://github.com/matsadler
[@debris]: https://github.com/debris
[@mati865]: https://github.com/mati865
[@lovebug356]: https://github.com/lovebug356
[@bryanburgers]: https://github.com/bryanburgers
[@shepmaster]: https://github.com/shepmaster
[@griff]: https://github.com/griff
[@lnicola]: https://github.com/lnicola
[@stjepang]: https://github.com/stjepang
[@kpp]: https://github.com/kpp
[@vorner]: https://github.com/vorner
[@sdroege]: https://github.com/sdroege
[@jonhoo]: https://github.com/jonhoo
[#340]: https://github.com/tokio-rs/tokio/issues/340
[#459]: https://github.com/tokio-rs/tokio/issues/459
[#470]: https://github.com/tokio-rs/tokio/issues/470
[#477]: https://github.com/tokio-rs/tokio/issues/477
[#479]: https://github.com/tokio-rs/tokio/issues/478
[#488]: https://github.com/tokio-rs/tokio/issues/488
[#517]: https://github.com/tokio-rs/tokio/issues/517
[#534]: https://github.com/tokio-rs/tokio/issues/534
