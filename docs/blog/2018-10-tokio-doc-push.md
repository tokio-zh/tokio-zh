# 宣布Tokio Doc Push（我们需要你！）

根据过去的反馈意见人们很难理解Tokio。我认为缺乏良好的文档起着重要作用。是时候解决这个问题了。

而且因为Tokio是开源的，我们（社区）才能实现这一目标！👏

但不要担心，这不是提供漫无目的的文档请求。但是，它确实需要参与。有很多方法可以参与任何级别的Tokio体验。

## Tokio文档推送

这计划是。[doc-push](https://github.com/tokio-rs/doc-push)已经设置了一个临时存储库 ，这是协调文档工作的地方。README有关于如何入门的步骤。粗略地说，这个过程将是：

1）阅读现有文档，跟踪令人困惑的部分或留下未回答的问题。

2）在doc-push存储库上打开一个问题以报告混淆。

3）解决问题。

4）重复。

“修复问题”的地方是修复现有指南或编写新指南。

## 编写新指南

为了引导编写的新指南，doc-push存储库已经添加了一个[轮廓](https://github.com/tokio-rs/doc-push/blob/master/outline/README.md)，展示我对如何构建指南的最佳猜测。

任何人都可以自愿写这个大纲的页面。只需提交一个PR，在页面旁边添加您的Github句柄即可。例如，如果你想自愿写超时指南，你将提交一个[PR更新的部分](https://github.com/tokio-rs/doc-push/blob/master/outline/tracking-time.md#timeouts)，改变状态：**未分配到状态**，到：**已分配**（@myname） 。

此外，非常感谢对大纲结构的反馈和建议。请再次打开大纲问题和PR。

如果你想参与，还有一个专门用于文档推送的新[Gitter通道](https://gitter.im/tokio-rs/doc-blitz)。但需要一些指导。加入频道并ping我们。也许您想尝试编写指南，但还不太了解任务。Ping我们，我们将帮助您完成它。

## 一个实验

文档推送是一项实验。我不知道它会怎样，但我希望它会成功。

这也是一种迭代的努力。一旦通过指南发生改进，我们需要回到步骤1）并让新来者尝试使用新文档学习Tokio。这将揭示需要解决的差距。

## 常问问题

**我还不知道Tokio！**

首先，这不是一个问题。

第二，太棒了！你是我们想要参与的人。我们需要新的眼睛来浏览指南并报告他们遇到的问题。

你可以做的事情：

- 阅读现有指南并报告[问题](https://github.com/tokio-rs/doc-push/issues/new)。
- 头脑风暴的[cookbook](https://github.com/tokio-rs/doc-push/issues/23)或[gotchas](https://github.com/tokio-rs/doc-push/issues/14)部分的项目。
- 审查并向[网站](https://github.com/tokio-rs/website/pulls)提供有关PR的反馈。

**我想提供指导，但我不确定我是否能够**

还也不是问题！

你知道他们说的是什么：“教学是最好的学习方式”。这是学习Tokio的好机会。首先，有一些大纲可以帮助您入门。这些大纲可能会导致您有疑问或需要一些指示。也许你需要在编写指南之前先学习这个主题！

我们在[Gitter频道](https://gitter.im/tokio-rs/doc-blitz)急切地等着帮助您。我们将帮助您了解您的需求。作为交换，您将贡献一份指南😊。

## tl;博士

这是让您更轻松学习Tokio的机会。没有志愿者推动服务于文档就不会发生这种情况。简而言之：

1）加入[Gitter频道](https://gitter.im/tokio-rs/doc-blitz)。

2）查看[repo](https://github.com/tokio-rs/doc-push)。

3）参与进来！

- @carllerche