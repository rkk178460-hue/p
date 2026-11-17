# Waterline · 8K 体积云离线单帧

基于 `1cd032743461068ae31df5d980f93ceff6c11306` 的海面实现，固定机位 `(0,4.98,21)`，朝向 `(0,3.98,-21)`，海况 46%，太阳时间 17:33，波浪时间 11.25 秒。

| 参数 | 上一帧 | 本帧 |
| --- | ---: | ---: |
| 分辨率 | 3840 × 2160 | 7680 × 4320 |
| 网格 | 1536 × 2560 | 3072 × 5120 |
| 顶点 | 3,932,161 | 15,728,641 |
| 三角形 | 7,861,760 | 31,452,160 |
| 相对网页原始网格采样量 | 64 倍 | 256 倍 |
| 固定时刻子像素样本 | 16 | 64 |

云从二维噪声替换为 `256 × 96 × 256` 的三维密度场，并用独立的 `64³` 周期细节体积刻画约 20–100 m 的侵蚀结构，包含低频天气覆盖、Perlin 风格的平滑噪声及 Worley 侵蚀。云底 1250 m、云顶上限 3350 m；48 次太阳方向采样计算自阴影，12 次向上采样近似天空遮挡，并用 3 个局部样本修正细节侵蚀后的太阳光程，512 步视线积分生成 `8192 × 4096` 的线性 HDR 上半球。视线使用曲面云壳交点，光照使用 Beer–Lambert 衰减、双 HG 相函数和多重散射近似。

天空及海面反射读取同一份云的辐射与透射率。反射按角度足迹使用 mip 过滤。水面太阳高光、浪尖透光及白沫使用同一密度场的云影，并补偿水面至云底的水平投影。六组交叉细波纹替代三组，保留法线导数过滤和未分辨坡度方差转移。

`enhance-source.mjs` 只对离线导入副本应用材质改动和 32 位网格索引，保留网页的交互性能预算。运行前核对原始 `main.js` 的 Git blob SHA，避免静默套用到不兼容版本。

## 运行

安装 Node.js 22 或更新版本，并提供可用的原生 WebGPU 图形适配器。已验证环境使用 Mesa 25.0.7 / LLVM 19 的 Lavapipe 软件 Vulkan，实际执行光栅化和像素回读。运行需要约数 GB 内存及数 GB 磁盘缓存。

```sh
cd waterline/offline
npm install
npm run render
```

默认使用 Vulkan。其他平台可设置 `WATERLINE_BACKEND` 为 Dawn 支持的后端；Linux 软件渲染可通过 Vulkan 标准的 `VK_DRIVER_FILES` 指向已安装的 Lavapipe ICD。程序请求的设备限额为 16384 的二维纹理尺寸和 1 GiB 的单缓冲上限。

快速查看构图：

```sh
STILL_WIDTH=1280 STILL_HEIGHT=720 STILL_SAMPLES=2 STILL_GRID_SCALE=8 npm run render
```

可调环境变量：`STILL_WIDTH`、`STILL_HEIGHT`、`STILL_SAMPLES`、`STILL_GRID_SCALE`、`STILL_OUTPUT`、`CLOUD_VOLUME`、`CLOUD_WIDTH`、`CLOUD_HEIGHT`、`CLOUD_STEPS`。云缓存针对代码中的固定光照和天气版本；修改云模型后应更新缓存前缀。

输出 PNG 包含渲染参数；旁边的 JSON 记录网格、云积分精度、实际子像素样本差异和渲染时间。64 个 HDR 样本在 Float32 中累计后，再执行 Bloom、暗角和一次 ACES/sRGB 转换。所有云计算管线检查 WGSL 编译诊断；最终检查 WebGPU validation error scope 和像素有限性。

实现参考：[Guerrilla 的体积云研究](https://www.guerrilla-games.com/read/nubis-evolved)、[NVIDIA 的体积渲染基础](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-39-volume-rendering-techniques)。本目录代码自行实现，未复制外部纹理或照片。
