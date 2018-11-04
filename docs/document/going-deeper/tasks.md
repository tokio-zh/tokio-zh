# 任务

任务是应用程序的“逻辑单元”。 它们类似于Go的goroutine和Erlang的进程，但是异步。 换句话说，任务是异步绿色线程。

鉴于任务运行异步逻辑位，它们由Future特征表示。 任务完成处理后，任务的`future`实现将以（）值完成。

任务被传递给执行程序，执行程序处理任务的调度。 执行程序通常在一组或一组线程中调度许多任务。 **任务不得执行计算繁重的逻辑，否则将阻止其他任务执行** 。 因此，不要尝试将斐波那契序列计算为任务。

任务通过直接实施Future特征或通过使用`future`和tokio crate中可用的各种组合函数构建`future`来实现。

下面是一个使用HTTP get从URI获取值并缓存结果的示例。

1. 检查缓存以查看是否存在URI条目。
2. 如果没有条目，请执行HTTP get。
3. 将响应存储在缓存中。
4. 返回response。

整个事件序列也包含超时，以防止无限制的执行时间。

```rust

// The functions here all return `Box<Future<...>>`. This is one
// of a number of ways to return futures. For more details on
// returning futures, see the "Returning futures" section in
// "Going deeper: Futures".

/// Get a URI from some remote cache.
fn cache_get(uri: &str)
    -> Box<Future<Item = Option<String>, Error = Error>>
{ ... }

fn cache_put(uri: &str, val: String)
    -> Box<Future<Item = (), Error = Error>>
{ ... }

/// Do a full HTTP get to a remote URL
fn http_get(uri: &str)
    -> Box<Future<Item = String, Error = Error>>
{ ... }

fn fetch_and_cache(url: &str)
    -> Box<Future<Item = String, Error = Error>>
{
    // The URL has to be converted to a string so that it can be
    // moved into the closure. Given futures are asynchronous,
    // the stack is not around anymore by the time the closure is called.
    let url = url.to_string();

    let response = http_get(&url)
        .and_then(move |response| {
            cache_put(&url, response.clone())
                .map(|_| response)
        });

    Box::new(response)
}

let url = "https://example.com";

let response = cache_get(url)
  .and_then(|resp| {
      // `Either` is a utility provided by the `futures` crate
      // that enables returning different futures from a single
      // closure without boxing.
      match resp {
          Some(resp) => Either::A(future::ok(resp)),
          None => {
              Either::B(fetch_and_cache(url))
          }
      }
  });

// Only let the task run for up to 20 seconds.
//
// This uses a fictional timer API. Use the `tokio-timer` crate for
// all your actual timer needs.
let task = Timeout::new(response, Duration::from_secs(20));

my_executor.spawn(task);
```

由于这些步骤对于完成任务都是必需的，因此将它们全部分组到同一任务中是有意义的。

但是，如果不是在缓存未命中时更新缓存，而是希望在一个时间间隔内更新缓存值，那么将其拆分为多个任务是有意义的，因为这些步骤不再直接相关。

```rust

let url = "https://example.com";

// An Interval is a stream that yields `()` on a fixed interval.
let update_cache = Interval::new(Duration::from_secs(60))
    // On each tick of the interval, update the cache. This is done
    // by using the same function from the previous snippet.
    .for_each(|_| {
        fetch_and_cache(url)
            .map(|resp| println!("updated cache with {}", resp))
    });

// Spawn the cache update task so that it runs in the background
my_executor.spawn(update_cache);

// Now, only get from the cache.
// (NB: see next section about ensuring the cache is up to date.)
let response = cache_get(url);
let task = Timeout::new(response, Duration::from_secs(20));

my_executor.spawn(task);
```

## 消息传递

就像Go和Erlang一样，任务可以使用消息传递进行通信。 实际上，使用消息传递来协调多个任务是很常见的。 这允许独立任务仍然相互作用。

`future`包提供了一个同步模块，其中包含一些适合跨任务传递消息的通道类型。

* oneshot是一个用于发送一个值的通道。
* mpsc是用于发送许多（零个或多个）值的通道。

前面的例子并不完全正确。 鉴于任务同时执行，无法保证缓存更新任务在其他任务尝试从缓存中读取时将第一个值写入缓存。

这是使用消息传递的完美情况。 高速缓存更新任务可以发送消息，通知其他任务它已使用初始值启动了高速缓存。

```rust
let url = "https://example.com";

let (primed_tx, primed_rx) = oneshot::channel();

let update_cache = fetch_and_cache(url)
    // Now, notify the other task that the cache is primed
    .then(|_| primed_tx.send(()))
    // Then we can start refreshing the cache on an interval
    .then(|_| {
        Interval::new(Duration::from_secs(60))
            .for_each(|_| {
                fetch_and_cache(url)
                    .map(|resp| println!("updated cache with {}", resp))
            })
    });

// Spawn the cache update task so that it runs in the background
my_executor.spawn(update_cache);

// First, wait for the cache to primed
let response = primed_rx
    .then(|_| cache_get(url));

let task = Timeout::new(response, Duration::from_secs(20));

my_executor.spawn(task);
```

## 任务通知

使用Tokio构建的应用程序被构造为一组并发运行的任务。 这是服务器的基本结构：

```rust
let server = listener.incoming().for_each(|socket| {
    // Spawn a task to process the connection
    tokio::spawn(process(socket));

    Ok(())
})
.map_err(|_| ()); // Just drop the error

tokio::run(server);
```

在这种情况下，我们为每个入站服务器套接字生成一个任务。 但是，也可以实现处理同一套接字上所有入站连接的服务器future：

```rust
pub struct Server {
    listener: TcpListener,
    connections: Vec<Box<Future<Item = (), Error = io::Error> + Send>>,
}

impl Future for Server {
    type Item = ();
    type Error = io::Error;

    fn poll(&mut self) -> Result<Async<()>, io::Error> {
        // First, accept all new connections
        loop {
            match self.listener.poll_accept()? {
                Async::Ready((socket, _)) => {
                    let connection = process(socket);
                    self.connections.push(connection);
                }
                Async::NotReady => break,
            }
        }

        // Now, poll all connection futures.
        let len = self.connections.len();

        for i in (0..len).rev() {
            match self.connections[i].poll()? {
                Async::Ready(_) => {
                    self.connections.remove(i);
                }
                Async::NotReady => {}
            }
        }

        // `NotReady` is returned here because the future never actually
        // completes. The server runs until it is dropped.
        Ok(Async::NotReady)
    }
}
```

这两种策略在功能上是等效的，但具有明显不同的运行时特性。

通知发生在任务级别。 该任务不知道哪个子`future`触发了通知。 因此，无论何时轮询任务，都必须尝试轮询所有子`future`。

![task](../../../static/imgs/task-layout.png)

在此任务中，有三个子`future`可以进行轮询。 如果其中一个子`future`所包含的资源转为“就绪”，则任务本身会收到通知，并会尝试轮询其所有三个子`future`。 其中一个将推进，这反过来推进任务的内部状态。

关键是尽量减少任务，尽可能少地完成每项任务。 这就是为什么服务器为每个连接生成新任务而不是在与侦听器相同的任务中处理连接的原因。

好吧，实际上有一种方法可以让任务知道哪个子`future`使用FuturesUnordered触发了通知，但通常正确的做法是生成一个新任务。
