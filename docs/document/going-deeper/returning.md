# 返回Futures

在处理 `future`时，您可能需要做的第一件事就是返回 `future`。 然而，与迭代器一样，这样做可能有点棘手。 有几种选择，从大多数到最不符合人体工程学：

* Trait objects
* impl Trait
* Named types
* Custom types

## Trait objects

首先，您始终可以选择返回一个Box `trait`对象：

```rust
fn foo() -> Box<Future<Item = u32, Error = io::Error>> {
    // ...
}
```

这个策略的好处是它很容易写下来（只是一个Box）并且易于创建。 就 `future`的方法变化而言，这也是最灵活的，因为任何类型的 `future`都可以作为不透明的Box Future返回。

这种方法的缺点是，在构建 `future`时需要运行时分配，在使用该 `future`时需要动态分派。 Box需要在堆上分配，然后将 `future`放在里面。 请注意，尽管这是此处唯一的分配，否则在执行 `future`时不会进行任何分配。

通常可以通过仅在您想要返回的 `future`长链的末尾装箱来降低成本，这仅需要整个链的单一分配和动态调度。

## impl Trait

如果您使用的Rust版本大于1.26，那么您可以使用语言功能impl Trait。 此语言功能将允许，例如：

```rust
fn add_10<F>(f: F) -> impl Future<Item = i32, Error = F::Error>
    where F: Future<Item = i32>,
{
    f.map(|i| i + 10)
}
```

这里我们用指定的关联类型指示返回类型是“实现Future的东西”。 除此之外，我们通常会像往常一样使用 `future`的组合器。

这种方法的优点在于它是零开销，没有Box需要，它对于 `future`的实现是最大的灵活性，因为实际的返回类型是隐藏的，并且它符合人体工程学，因为它类似于上面的漂亮Box示例。

这种方法的缺点是只使用Box更灵活 - 如果你可能返回两种不同类型的Future，然后你仍然必须返回`Box <Future <Item = F :: Item，Error = F :: Error>`而不是`impl Future <Item = F :: Item，Error = F :: Error>`。 然而，好消息是这种情况很少见; 一般来说，它应该是一个向后兼容的扩展，用于将返回类型从`Box`更改为`impl Trait`。

## Named types

如果您不想返回Box并希望坚持使用旧版本的Rust，另一种选择是直接编写返回类型：

```rust
fn add_10<F>(f: F) -> Map<F, fn(i32) -> i32>
    where F: Future<Item = i32>,
{
    fn do_map(i: i32) -> i32 { i + 10 }
    f.map(do_map)
}
```

这里我们将返回类型命名为编译器看到的完全一样。 map函数返回Map结构，该结构在内部包含future和执行map的函数。

这种方法的优点是它没有以前Box的运行时开销，并且可以在1.26之前的Rust版本上运行。

然而，缺点是，通常很难命名这种类型。 有时类型可能会变得非常大或完全无法命名。 这里我们使用函数指针`（fn（i32） - > i32）`，但我们理想情况下使用闭包。 不幸的是，返回类型暂时无法命名闭包。 它还会导致非常详细的签名，并向客户泄露实施细节。

## Custom types

最后，您可以将具体的返回类型包装在一个新类型中，并为它实现 `future`。 例如：

```rust
struct MyFuture {
    inner: Sender<i32>,
}

fn foo() -> MyFuture {
    let (tx, rx) = oneshot::channel();
    // ...
    MyFuture { inner: tx }
}

impl Future for MyFuture {
    // ...
}
```

在这个例子中，我们返回一个自定义类型MyFuture，我们直接为它实现Future trait。 此实现利用了底层的`Oneshot <i32>`，但也可以在此处实现任何其他类型的协议。

这种方法的好处是它不需要Box分配，它仍然是最大的灵活性。 MyFuture的实现细节对外界是隐藏的，因此可以在不破坏其他情况的情况下进行更改。

然而，这种方法的缺点是，这是返回 `future`最不符合人体工程学的方法。