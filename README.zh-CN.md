<p align="center">
  <img src="assets/logo.svg" alt="SnipFlow Logo" width="120" height="120" />
</p>

<h1 align="center">SnipFlow</h1>

<p align="center">
  <strong>基于 Rust 与 FFmpeg 的超高速本地极简无损视频剪辑、静音剔除与 NLE 预剪辑工作站。</strong>
  <br />
  <em>混合 Smart-GOP 微渲染 · 人声带通滤波静音剔除 · 毫秒级 CMX 3600 EDL 与 FCPXML 时间线导出。</em>
  <br />
  <a href="README.md">English Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/Mresyzz/SnipFlow/releases"><img src="https://img.shields.io/github/v/release/Mresyzz/SnipFlow?style=flat-square&color=00f2fe&label=Release" alt="Latest Release" /></a>
  <a href="https://crates.io/crates/snipflow"><img src="https://img.shields.io/crates/v/snipflow?style=flat-square&color=ff8008&label=Cargo" alt="Crates.io" /></a>
  <a href="https://github.com/Mresyzz/opsscript-gate"><img src="https://img.shields.io/badge/OpsScript%20Gate-Verified-2088FF?style=flat-square&logo=linux" alt="OpsScript Gate Verified" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square" alt="License: GPL-3.0" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.78+-orange.svg?style=flat-square&logo=rust" alt="Rust Version" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform Support" />
  <a href="https://github.com/Mresyzz/SnipFlow/stargazers"><img src="https://img.shields.io/github/stars/Mresyzz/SnipFlow?style=flat-square&color=gold" alt="GitHub Stars" /></a>
</p>

---

## 为什么选择 SnipFlow？

传统非线性视频编辑器（Premiere Pro、剪映、DaVinci Resolve）将每一次粗剪都视作繁重的工程项目。它们强制生成重型工程文件、渲染代理并执行耗费数分钟至数小时的有损重压缩流程，严重损伤原始码率。

相比之下，传统的开源流媒体工具（如 LosslessCut、HandBrake）要么基于沉重的 Electron 运行时，要么依赖全手动区间选取，对于长录播、相机原片或游戏录像缺乏自动化智能分析支持。

SnipFlow 打破了这一架构壁垒：将原生低延迟的系统性能与智能启发式预剪辑自动化深度融合——直接在流媒体数据包层面执行操作，或将非破坏性的 `.edl` / `.fcpxml` 时间线秒级导入 DaVinci Resolve、Premiere Pro 和 Final Cut Pro。

| 评估指标 / 功能特性 | SnipFlow | LosslessCut | Premiere / 剪映 | 网页端剪辑工具 |
| :--- | :---: | :---: | :---: | :---: |
| **冷启动耗时** | **< 0.2 秒 (原生 Rust)** | ~2.5 秒 (Electron) | 15 秒 – 45 秒 (重型 NLE) | 依赖网络加载 |
| **内存占用 (空闲)** | **< 45 MB** | ~280 MB | ~1.5 GB+ | ~400 MB+ |
| **导出引擎** | **三态模式 (`Stream Copy` / `Smart GOP` / `Exact`)** | 单一 Stream Copy | 全量重编码 (有损) | 云端重编码 |
| **导出耗时 (1小时 4K 原片)** | **~0.1 秒 – 0.6 秒** | ~0.5 秒 – 2 秒 | 8 – 25 分钟 | 上传 + 云端排队渲染 |
| **自动化静音剔除** | **人声带通滤波 + 60ms 自然呼吸缓冲** | 仅支持手动 | 手动操作 / 复杂插件 | 付费功能 / 排队处理 |
| **非破坏性 NLE 时间线导出** | **CMX 3600 `.edl` 与 FCPXML v1.9 `.fcpxml`** | CSV / 基础文本 | 封闭格式锁定 | 无 |
| **多模态高光峰值检测** | **音频 EBU R128 瞬态 + 视觉关键帧场景流** | 无 | 无 | 无 |
| **无头批量 CLI 自动化** | **原生内置 (`--batch` 与 `--nle`)** | 仅有限支持 | 需配合 Media Encoder | 无 |

---

## 核心架构与技术亮点

### 1. 混合 Smart-GOP 微渲染三态导出引擎
纯流拷贝（`-c copy`）受物理关键帧（I 帧）边界约束。SnipFlow 在 GUI 与 CLI 中均提供确定性的三态引擎支持：
- **`SMART GOP` (`CutMode::SmartCopy`)**：检查 PTS 关键帧对齐。若入点处于 GOP 内部，仅对局部的首个 GOP 区间 `[入点 -> 下一个关键帧]`（通常仅 0.2s–1.5s）进行微渲染，并与后续零重编码流拷贝区间 `[关键帧 -> 出点]` 实施无缝拼合，确保 99%+ 的内容绝对无损。
- **`STREAM COPY` (`CutMode::StreamCopy`)**：纯零重编码解复用/复用透传，配备实时毫秒级 GOP 漂移指示器（`SNAP (+120ms)`）与磁性关键帧吸附。
- **`EXACT FRAME` (`CutMode::ExactFrame`)**：极速全片段重编码兜底模式（`-c:v libx264 -preset ultrafast -crf 18 -c:a copy`），适用于严重损毁的动态可变帧率（VFR）媒体。

### 2. 人声带通滤波、60ms 自然呼吸缓冲与底噪自动校准
- **人声频段隔离**：在进行 `silencedetect` 与 `volumedetect` 前置链路中接入 `85Hz – 7800Hz` 硬件级带通滤波（`highpass=f=85,lowpass=f=7800`），滤除空调低频嗡鸣与电流杂音，同时确保导出的音频流 100% 原始无损。
- **自然呼吸缓冲（60ms）**：自动在语音起点前与终点后保留 60ms 声学余量，彻底消除爆破音被截断或语音转折僵硬的问题。
- **一键底噪自动校准**：`AUTO CAL` 音量探针分析全局音轨的 `mean_volume` 与 `max_volume` 分布，自动计算出当前素材的最优静音门限分贝值。

### 3. 非破坏性 NLE 剪辑时间线导出（CMX 3600 EDL 与 FCPXML v1.9）
将 SnipFlow 用作调色或特效合成前的高速初剪分流工作站：
- 耗时 **< 5 毫秒** 即可将所有保留的有效发言片段导出为工业级标准的 **CMX 3600 `.edl`** 与 **Final Cut Pro `.fcpxml` (v1.9)** 文件。
- 可直接导入 **DaVinci Resolve**、**Adobe Premiere Pro** 或 **Final Cut Pro X**，无需拷贝多余文件即可非破坏性自动链接原片。

### 4. 多模态高光发现（音频 EBU R128 + 画面场景流）
- **频段过滤 EBU R128 瞬态响度**：隔离人声高亢与动作撞击瞬态（`120Hz – 6000Hz`），同时抑制机械键盘敲击突刺。
- **基于关键帧的场景突变检测 (`-skip_frame nokey`)**：直接在 I 帧上评估视觉流（`select='gt(scene,0.32)'`），无需解码庞大的中间帧，即便在完全静音的桌面录屏中也能精准捕捉操作断点。

---

## 安装方法

### 一键自动安装 (Linux & macOS)

使用经过 [OpsScript Gate](https://github.com/Mresyzz/opsscript-gate) 在 Debian、Ubuntu 与 Alpine 真实容器中完整门禁验证的一键安装脚本，自动将二进制部署至 `~/.local/bin`：

```bash
curl -fsSL https://raw.githubusercontent.com/Mresyzz/SnipFlow/main/install.sh | bash
```

> **说明**：安装脚本会自动校验系统架构，下载匹配的预编译包，检测本地 FFmpeg 运行环境，并在缺失依赖时给出匹配当前 Linux 发行版（APT / APK / DNF / Pacman）的精确安装指令。

### 预编译二进制文件下载

可在 [Releases](https://github.com/Mresyzz/SnipFlow/releases) 页面下载免安装归档包：

- **Windows**: `snipflow-v*-x86_64-pc-windows-msvc.zip`（零配置便携包，自带静态 `ffmpeg.exe` 与 `ffprobe.exe`）
- **macOS (Apple Silicon M系列)**: `snipflow-v*-aarch64-apple-darwin.tar.gz`
- **macOS (Intel)**: `snipflow-v*-x86_64-apple-darwin.tar.gz`
- **Linux (x86_64)**: `snipflow-v*-x86_64-unknown-linux-gnu.tar.gz`

### 通过 Cargo (crates.io) 安装

SnipFlow 采用进程隔离流水线与 FFmpeg 交互——从源码编译时**无需安装 C 语言开发头文件、`libavcodec-dev` 或配置 `PKG_CONFIG_PATH`**：

```bash
cargo install snipflow
```

---

## 命令行 CLI 与批量自动化

除桌面 Studio 界面外，SnipFlow 还提供完整的无头 CLI 接口，适用于服务端工作流与海量素材自动化分流：

```bash
# 启动桌面 Studio GUI
snipflow

# 单文件自动剔除静音、Smart-GOP 无缝合并并生成 NLE 时间线
snipflow --cli raw_lecture.mp4 clean_lecture.mp4 --nle

# 批量处理整个目录的素材，结合自动底噪校准导出无损视频与 EDL/FCPXML 时间线
snipflow --batch ./raw_recordings --out-dir ./cleaned_vods --min-silence 0.5 --mode smart --nle
```

---

## 常用键盘快捷键

| 快捷键 | 功能 | 说明 |
| :--- | :--- | :--- |
| `Space` | **播放 / 暂停** | 切换当前速度下的播放与暂停 |
| `J` / `K` / `L` | **穿梭快进控制** | 后退 2 秒 / 暂停 / 循环切换播放速度（`1x` -> `1.5x` -> `2x` -> `4x`） |
| `S` | **实时跳过静音** | 实时预听模式：在回放过程中自动跳过所有静音死区 |
| `X` | **剃刀切分** | 在当前播放头位置切分当前活跃片段 |
| `P` | **原画帧快照** | 毫秒级提取并导出当前帧无损高保真原画封面（`.jpg`） |
| `←` / `→` | **逐帧微调** | 播放头后退 / 前进 1 帧 |
| `Shift + ←` / `→` | **关键帧跳转** | 直接跳转至上一个 / 下一个物理 GOP 关键帧（I 帧） |
| `I` / `O` | **标记入点 / 出点** | 设定裁剪区间起止（亦可在时间轴上直接拖拽 `[` 与 `]` 手柄） |
| `H` | **跳至下一高光** | 播放头自动定位到下一个检测到的音视频高光峰值 |
| `Ctrl + Z` / `Ctrl + Y` | **撤销 / 重做** | 无损撤销或恢复剪辑片段的增删调整操作 |
| `Ctrl + O` | **打开视频文件** | 呼出原生文件对话框切换媒体素材 |
| `Enter` | **执行剪辑导出** | 使用当前选定的引擎模式执行导出 |

---

## 开源协议

本项目基于 [GNU General Public License v3.0 (GPL-3.0-or-later)](LICENSE) 协议开源。
