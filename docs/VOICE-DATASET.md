# 大肥鱼音色数据集

来源：`https://modelscope.cn/datasets/YinZilu/da-fei-yu-girl-voice-zh`

- 许可：CC BY-NC 4.0（非商业）
- 规模：151 个音频文件，约 29 分 43 秒
- 内容：145 条带文本中文语音 + 6 个演唱干声
- 用途：GPT-SoVITS / RVC 训练与推理实验

## 本地准备

- 原始数据：`D:\DSH\voices\da-fei-yu`
- GPT-SoVITS 输入：`D:\DSH\voices\gpt-sovits-da-fei-yu`（145 条，32kHz，含 gpt_sovits.list）
- RVC 输入：`D:\DSH\voices\rvc-da-fei-yu`（151 条，40kHz，含 metadata.csv）

## 注意

这是声音数据集，不是现成的 TTS/RVC 模型。
要真正换成这个音色，还需要 GPT-SoVITS 或 RVC 的推理/训练环境。
音频不提交到公开仓库，只在本地使用；非商业用途。

## 推荐参考片段

`D:\DSH\voices\reference-da-fei-yu.wav`

约 4.5 秒，来自数据集 `dwg_0002`，可用于 GPT-SoVITS 零样本试听。
