# 无人机任务链可视化研究工作台 v0.9.2

本网站用于解释物资配送、搜索救援和农田喷洒场景中的无人机任务分配、飞行决策、机载推理、通信回传、能源消耗、温升、安全约束和联邦更新指标。

## 在线访问与本地使用

公开网站：[https://yzl-dragon.github.io/uav-mission-glassbox/](https://yzl-dragon.github.io/uav-mission-glassbox/)

- 在线版由 GitHub Actions 在测试全部通过后自动生成并部署，浏览器访问时不依赖应用服务器、数据库、Node.js 或 Python。
- 本地版仍可双击 `打开无人机可视化网站.html` 使用；这个文件是完整的单文件离线交付物，不需要联网。
- 外部飞行日志和 `benchmark.json` 只由当前浏览器在本地读取，网站不会把这些文件上传到 GitHub。
- 仓库公开展示源码、内置仿真数据、测试和构建脚本，但当前未附带开源许可证；除法律另有规定外，不授予复制、修改或再发布源码的许可。
- 网站只用于科研解释、仿真回放和实验展示，不连接、不指挥、不控制真实无人机。

v0.9.2 新增 GitHub Pages 公开发布流程、Pages 单文件产物和部署前自动验收。网站功能逻辑、实时代理状态机、世界坐标、阶段 4A/4B/4C 以及 v0.5 多机防卡死避障核心逻辑没有改变。

面向网站观看者的逐区说明、指标高低解释、实验图表阅读方法和常见误读，请参阅：

```text
网站功能与使用说明.md
```

## 1. 最简单的打开方法：直接双击

双击本文件夹中的：

```text
打开无人机可视化网站.html
```

即可在默认浏览器中打开网站。

这个 HTML 是“单文件离线版”，网页程序、样式、三套 Python 基准数据和五组实验统计包都已经嵌入文件内部：

- 不需要启动服务器；
- 不需要安装 Node.js、npm 或 Python；
- 不需要联网；
- 可以把这一个 HTML 单独复制到别处使用。

如果双击后系统询问使用哪个应用，请选择 Safari、Chrome 或 Edge。极少数单位电脑可能通过安全策略禁止本地 JavaScript，这种情况下需要使用后面的“开发模式”。

## 2. 已实现的扩展内容

### 2.1 Python 仿真结果回放

网站已经嵌入原无人机仿真器生成的：

- `timeline.csv`：每个时刻的无人机位置、电量、温度、任务动作、通信状态和模型版本；
- `summary.json`：任务成功率、总能耗、总航程、通信次数、本地更新次数和约束违规数。

页面顶部可以切换：

- `实时代理`：浏览器中实时运行任务状态机；
- `Python 回放`：逐事件回放原始 CSV 数据；
- `动力学回放`：对 Python 轨迹进行平滑二阶插值；
- `外部日志`：导入 RotorPy、Gym-PyBullet-Drones、PX4 或其他仿真/飞控结果。

三套原始数据位于：

```text
app/data/python/logistics/
app/data/python/rescue/
app/data/python/spraying/
```

`scripts/generate-research-data.mjs` 会把它们转换为网站可直接打包的数据。

### 2.2 复杂地形、风场、禁飞区、动态障碍和机间避碰

任务场景现在包含以下环境图层：

- 时变二维风场，满足 `v_ground = v_cmd + w(t)`；
- 城市高楼峡谷、密集塔群和施工障碍；
- 救援场景的瓦砾陡坡、洪水断面、断壁峡口和烟尘盲区；
- 农田场景的丘陵、水塘和防风林带；
- 圆形禁飞区及安全半径；
- 两个随时间移动的动态障碍物；
- 无人机之间的最小安全距离连线；
- 基于吸引项和排斥项的局部安全航向修正；
- 逆风附加能耗和温升代理。

地图右上角可以分别显示或隐藏复杂地形、风场、禁飞区、动态障碍和机间距离。复杂地形不仅参与绘制，也会进入局部排斥项和安全航向修正。

当前局部避障采用：

```text
u_safe = normalize(u_target + Σ u_repulsive)
p(t+Δt) = p(t) + v u_safe Δt + 0.11 w(t) Δt
```

复杂地形、禁飞区、动态障碍和其他无人机进入影响半径后，排斥项会自动增大。

### 2.3 RotorPy / Gym-PyBullet-Drones 外部轨迹接口

网站支持以下标准回放 JSON：

```json
{
  "engine": "RotorPy",
  "scenario": "logistics",
  "samples": [
    {
      "time_s": 0.02,
      "drone_id": 0,
      "x": 1.2,
      "y": 0.8,
      "z": 2.0,
      "vx": 0.4,
      "vy": 0.1,
      "vz": 0.0,
      "battery_pct": 96.5,
      "temperature_c": 31.2,
      "action": "FLY_AND_INFER",
      "task_id": "L1"
    }
  ]
}
```

附带转换器：

```bash
python3 scripts/convert_flight_log.py rotorpy_result.npz replay.json \
  --engine RotorPy --scenario logistics

python3 scripts/convert_flight_log.py pybullet_log.csv replay.json \
  --engine Gym-PyBullet-Drones --scenario rescue
```

生成 `replay.json` 后，在网站中点击“外部日志”或“导入外部回放 JSON”。外部轨迹会替换网页的运动代理。

说明：网站内置的“动力学回放”是平滑二阶轨迹示例，不冒充真实 RotorPy/PyBullet 运行结果；真正的第三方仿真结果需要通过上述接口导入。这种设计避免强制安装较大的物理仿真环境，同时保留完整接入能力。

### 2.4 真实端侧模型指标接口

网站增加了参数量、推理延迟、P95 延迟和峰值内存面板。默认不填写虚构实测值；需要导入真实设备或本机生成的 `benchmark.json`。

附带 ONNX 基准脚本：

```bash
python3 -m pip install numpy onnx onnxruntime

python3 scripts/benchmark_onnx_model.py model.onnx benchmark.json \
  --shape 1,3,224,224 \
  --runs 30 \
  --baseline-params-m 100
```

然后点击网站中的“导入 benchmark.json”。网站会自动判断：

- 参数量是否小于显式基线的 `1/10`；
- 峰值内存是否满足 `≤ 100 MB`；
- 中位推理延迟和 P95 延迟。

峰值内存来自进程峰值 RSS，适合做初步筛选；最终课题指标仍建议在目标终端硬件上重复测量。

峰值内存必须依赖具体数据才能给出可信值，因为：

```text
M_peak = M_weights + M_activations + M_runtime_workspace
```

其中权重内存由参数量和 FP32/FP16/INT8 精度决定，中间激活由输入尺寸和网络结构决定，运行时工作区还会随 ONNX Runtime/TensorRT、CPU/GPU/NPU 和驱动版本改变。只有模型文件而没有目标设备时，可以估算权重大小，但不能把估算值当作峰值内存。因此网页默认显示 `—`，导入实际 `benchmark.json` 后才显示具体 MB 数值。

### 2.5 成功率、能耗、时延和 Non-IID 对比

网站增加了实验区，显示：

- 按时完成任务数和成功率；
- 总能耗；
- 总航程；
- 通信次数和本地更新次数；
- FedAvg、FedProx、SCAFFOLD 的 Non-IID 演示收敛曲线；
- 相对 FedAvg 的准确率损失降低比例。

可以调整异质度滑块 `α`，观察数据异质性增加后不同方法的变化。

这部分曲线明确标记为“演示曲线”，用于理解指标和数学关系，不作为课题最终实验结论。后续可以用真实联邦训练日志替换曲线数据。

### 2.6 地图交互、机群规模与人工任务下发

- 地图提供缩小、放大、适配全部、聚焦选中、仅选中航迹、俯视/等距和专注模式；专注时遥测改为可收起的叠加抽屉。
- 可以直接点击航迹画布中的无人机，右侧会选中同一架无人机并更新位置、电量、温度、速度、决策和任务信息。
- 画布获得键盘焦点后，也可以用方向键依次选择无人机。
- “实时机群规模”支持人工设置 `1–12` 架无人机；调整规模会重置实时仿真，并按优先级重新分配当前场景任务。
- 在右侧选中无人机后，可从“人工任务下发”中选择任务，将其插入该机任务队列。
- 已经显示“已完成”的任务会标记为“重新执行”，可以重新开启并下发为下一架次；重新开启后，该任务的当前轮状态会回到队列中。
- 正在由另一架无人机现场执行的任务不能中途转派；需要等该次现场作业结束后再重新下发。

地图和任务表还为每个目标增加了真实语义化地点名称与任务原因，例如“和安社区卫生站—慢病患者急需处方药”“北区通信基站—停电后维持应急通信”“老城商场废墟—高温目标疑似被困人员”。这些名称用于解释无人机为什么必须前往该建筑或区域。

人工改写只适用于“实时代理”。Python 回放、动力学回放和外部日志必须保持原始数据中的机群数量和任务归属，因此是只读的；调节机群规模时网站会自动切回实时代理。

### 2.7 多无人机防卡死避障

旧版采用完全对称的机间排斥势场，多架无人机接近时可能互相施加大小相近、方向相反的排斥力，从而停在局部平衡点。v0.5 增加了以下防死锁机制：

- 停机位半径由 `2.5 m` 扩大到首圈 `5.5 m`，避免无人机起飞前就违反 `5 m` 机间距；
- 不同无人机使用分层巡航高度，机间距按三维距离计算；
- 地面待命、补能无人机不参与空中互斥，避免返航无人机被停机位堵住；
- 通行权首先考虑低电量紧急返航，其次考虑任务优先级，同分时由无人机编号确定，消除对称决策；
- 需要让行的无人机不会原地完全停止，而是降低速度并沿统一侧向规则绕行；
- 若到目标的距离连续 `2.2 s` 没有有效下降，则触发“脱困侧移”，跳出障碍物或多机形成的局部势场平衡点。

通行权评分代理为：

```text
score_i = 500 · I(低电量返航) + 20 · priority_i - 0.01 · id_i
```

右侧遥测会显示“航迹清晰、绕开地形、机间让行、脱困侧移”四种状态，以及当前停滞检测计时。

### 2.8 数据正确性与五组实验工作台

v0.6 按 `code/experiments/WEBSITE_INTEGRATION_SPEC.md` 完成阶段 A 和阶段 B：

- `app/data/python/` 已与 `code/results/` 的最新基准同步，汇总数据由 11 个字段扩展为当前仿真器的完整指标；
- Python/动力学回放从时间线唯一 `drone_id` 动态生成机队，不再固定为 3 架；
- 回放高度直接使用真实 `z`，速度使用 `sqrt(vx²+vy²+vz²)`，电量百分比按每架无人机时间线初值换算；
- 保留 `z/v/a`、链路类型、带宽、PDR、时延和缓存量；
- `STORE_AND_WAIT`、`DEFER_UPLOAD`、`COOL_DOWN`、`YIELD`、`DECONFLICT_CLIMB`、`AVOID_DYNAMIC` 和 `AVOID_NO_FLY` 均有独立中文动作语义；
- 回放模式不再叠加实时代理的硬编码地形、风场、禁飞区或动态障碍；外部日志未携带汇总时不显示旧 Python 指标；
- 新增独立“实验工作台”，完整读取通信、电量、温度、多机、禁飞区/障碍五组实验；
- 曲线显示仿真端预计算的均值与 95% 置信区间，热图显示二维压力矩阵；每张图固定显示横轴、纵轴/颜色和图意；
- 点击曲线点或热图格子可查看配置、运行次数、均值、置信区间与安全约束；
- 20-seed 统计结果与单个 seed 代表案例明确分区，不混为同一数字；实验 05 的代表案例保存真实轴对齐三维禁飞盒几何。

实验数据链为：

```text
code/experiments/*/results/
  → code/experiments/export_website_bundle.py
  → code/integration_exports/experiment_bundle.json
  → app/data/experiments/experiment_bundle.json
  → scripts/generate-experiment-data.mjs
  → app/generated/experimentData.ts
```

统计均值和 95% 置信区间由导出器计算，浏览器只筛选、联动和绘图，不重新聚合原始 seed。

### 2.9 世界坐标主地图与代表案例回放

v0.7 按 MAP_VISUALIZATION_CHANGE_REQUEST.md 和 code/integration_exports/output/pdf/map_visualization_review.pdf 完成前三阶段：

- 新增 WorldPoint、ScreenPoint 与 TrailSample 类型；Python、动力学、实验案例和外部日志的源 x/y/z 不再归一化改写；
- 世界坐标只在 MissionMap 绘制时投影为屏幕像素，缩放、平移或切换俯视/等距视图不会改变遥测、安全距离或任务坐标；
- 每个轨迹样本保留自身 x/y/z/time/action 及可用遥测，垂直解冲突和返航下降按真实逐点高度绘制；
- 外部日志只有显式声明 units: "m" 才显示米；未声明时显示“源坐标单位未声明”，不把未知单位冒充为米；
- 五组实验共 15 个单 seed 代表案例均可通过“在主地图回放此案例”进入主地图，页面同时标明它不是 20-seed 均值；
- 代表案例的机队、任务、时间线、配置、汇总与环境均来自 experiment_bundle.json，且保持只读；
- 实验 05 的禁飞区按两个轴对齐三维盒绘制；动态障碍仅显示导出的数量、模型说明和 AVOID_DYNAMIC 事件位置，不伪造障碍物轨迹；
- 地图新增底部事件时间轴、拖动跳转、前后事件、下一关键事件、动作筛选和 1×/2×/4×速度；
- 地图支持拖动平移、适配全部、聚焦选中、仅显示选中航迹、俯视/等距切换和重置视图；
- 遥测栏可收起；地图专注模式占满视口，遥测作为可开关抽屉叠加，不再固定占用侧栏；
- 图例根据当前实际数据图层显示任务、无人机、航迹、禁飞区、动态事件、链路和安全距离状态。

### 2.10 三维场景代理与阶段 4B 数据图层

v0.8 按 `MAP_3D_RESTORE_AND_PHASE4_REQUEST.md` 完成阶段 4A 和 4B：

- 旧 `IsoScene` 不再作为主地图；建筑、道路、农田、地形和三维无人机能力已经迁入新的 `MissionMap` 世界坐标投影架构；
- 新增 `app/data/sceneModels.ts` 与 `app/lib/sceneRenderer.ts`，城市建筑/道路、灾区残墙/瓦砾/积水、农田条带/丘陵/水塘/林带均是独立场景代理；
- 每个场景代理对象固定声明 `source: "proxy"` 与 `affectsPhysics: false`，页面和图例持续标注“场景代理模型 · 不参与计算”；
- 实验自动适配只使用基地、任务、无人机、真实三维航迹、源事件和数据源禁飞盒；固定 0–100 代理域只用于实时代理模式；
- 三维无人机在所有模式默认开启，包含机身、机臂、四旋翼、载荷、阴影、高度垂线、选中光环、编号、z 高度、源动作标签和仅标为 `v` 的速度方向；没有姿态数据时不伪造机头朝向；
- 场景代理和无人机模型均有独立开关；代理模型支持低/中/高三档细节，关闭代理不会改变任何世界坐标、任务状态、航迹或指标；
- 通信层读取源 `link_up`、链路类型、带宽、PDR、时延、缓存和待上传结果，并显示 `STORE_AND_WAIT` / `DEFER_UPLOAD` 事件；无基站坐标时，基地明确标为“代理通信端点”；
- 电量层按 `battery_wh` 为航迹渐变着色，显示储备阈值、`RETURN`、`TURNAROUND` 与补能语义；参数不足时不绘制虚构可达域；
- 温度层按源温度为航迹渐变着色，显示热安全上限、`COOL_DOWN` 与 `LOCAL_UPDATE` 事件；代理仿真温度不标为硬件实测；
- 多机安全层按三维距离计算包络、预警机对、CPA 和 TTC，并保留 `YIELD` 与 `DECONFLICT_CLIMB` 的真实高度变化；
- 禁飞区层绘制数据源三维盒及上下高度边界；动态障碍只显示数据包给出的数量、模型和 `AVOID_DYNAMIC` 事件位置，不生成伪造移动轨迹。

### 2.11 v0.8.1 控制安全区与阶段 4C 同步对照

v0.8.1 先修复地图专注模式中机队状态覆盖缩放工具条的阻断问题：

- 地图工具条拆分为始终可见的逃生控制和可折叠辅助控制；缩小、缩放比例、放大、适配、重置、收起/展开机队和退出专注始终保留；
- 专注模式展开机队时，桌面端通过统一安全距离把工具条移到抽屉左侧；窄屏将机队改为底部抽屉；
- 机队抽屉提供独立且固定可见的关闭按钮，关闭后焦点回到“展开机队状态”；
- `+`/`=`、`-`、`0`、`T` 和 `Esc` 提供键盘退路；最小/最大缩放时只禁用对应方向；
- 1920×1080、1440×900、1280×800 和 720×900 均完成真实点击操作链及矩形不相交检查，并覆盖 1、8、12 架机队。

阶段 4C 在上述验收通过后实现：

- 默认宽屏左右双地图，中屏上下双地图，窄屏使用“基准/压力”标签切换；
- 五组预设分别为通信 `baseline / stress`、电量 `baseline_logistics / strict_logistics`、温度 `baseline_rescue / hot_heavy_rescue`、多机 `three_uav / eight_uav`、禁飞区 `baseline / combined_stress`；
- 两侧共享播放、暂停、绝对秒时间轴、速度和关键事件跳转；主时间轴取两案例较大持续时间，较短案例结束后冻结最后一帧并明确标记，不外推；
- 两张地图分别读取各自 `experiment_bundle.json` single-seed 任务、世界坐标、轨迹、事件和环境；只有场景、米制坐标、任务几何和机数都一致时才允许幽灵航迹；
- 实验 04 的三机/八机机数不同，因此幽灵航迹开关自动禁用，但仍可左右同步对照；
- 使用一个共享机队检查器；单侧选择无人机后显示该侧源事件时刻、三维位置/速度、电量、温度、链路与缓存；
- 指标差值明确标为“单 seed 对单 seed、B−A”；20-seed 均值和置信区间仍只在实验工作台显示，严禁构造平均轨迹；
- 两侧地图都有缩小、放大、适配、重置和投影切换，退出对照按钮位于地图之外，不会被机队检查器覆盖。

## 3. 推荐观看顺序

1. 双击 `打开无人机可视化网站.html`。
2. 选择物资配送、搜索救援或农田喷洒。
3. 先观看“实时代理”，观察无人机如何绕开复杂地形、红色禁飞区和橙色动态障碍。
4. 点击 `Python 回放`，查看原始仿真事件和真实汇总数据。
5. 点击 `动力学回放`，比较离散事件与平滑运动的区别。
6. 使用地图的缩放、平移、聚焦、仅选中航迹或专注模式，并直接点击画布中的任意无人机。
7. 在右侧把实时机群调整为需要的数量，再给选中的无人机下发任务。
8. 查看数学边界、原始实验指标、端侧模型指标和 Non-IID 曲线。
9. 在实验工作台选择任一代表案例，点击“在主地图回放此案例”，再用底部时间轴检查关键动作。
10. 继续查看“阶段 4C”双地图区，在五类可比案例对之间切换，并用共享绝对秒时间轴定位通信、返航、冷却、多机冲突和禁飞事件。
11. 如果有 RotorPy/PyBullet 日志或 ONNX 基准结果，再使用导入按钮。

## 4. 开发模式

直接双击 HTML 不需要以下步骤。只有修改源码时才需要开发环境。

环境要求：Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

正式构建：

```bash
npm run build
```

重新生成单文件离线版：

```bash
npm run build:offline
```

生成 GitHub Pages 产物：

```bash
npm run build:pages
```

该命令重新生成单文件网站，并将同一内容复制到 `pages-dist/index.html`，同时生成 `pages-dist/.nojekyll`。部署前应确认两个 HTML 的 SHA-256 一致。

自动测试：

```bash
node --test tests/*.test.mjs
node --test tests/traffic-avoidance.test.ts
```

重新读取 Python CSV/JSON 数据：

```bash
node scripts/generate-research-data.mjs
npm run build:offline
```

重新导出五组实验并生成网站数据：

```bash
python3 ../code/experiments/export_website_bundle.py \
  --output ../code/integration_exports/experiment_bundle.json

cp ../code/integration_exports/experiment_bundle.json \
  app/data/experiments/experiment_bundle.json

node scripts/generate-experiment-data.mjs
npm run build:offline
```

## 5. 主要文件

```text
无人机可视化网站/
├── 打开无人机可视化网站.html  # 可直接双击的完整单文件网站
├── app/
│   ├── page.tsx                 # 仿真、回放、环境、指标和界面
│   ├── components/
│   │   ├── MissionMap.tsx       # 世界坐标投影、三维盒与主地图绘制
│   │   ├── MapControlDock.tsx   # v0.8.1 不可遮挡逃生控制与辅助控制
│   │   ├── MapTimeline.tsx      # 回放事件时间轴
│   │   ├── MapLegend.tsx        # 按实际图层生成的图例
│   │   ├── ExperimentLab.tsx    # 五组实验与代表案例入口
│   │   └── ExperimentComparison.tsx # 阶段 4C 双地图同步、共享机队与差值
│   ├── lib/
│   │   ├── replayAdapter.ts     # 统一回放类型和世界坐标适配
│   │   ├── mapProjection.ts     # 世界坐标到屏幕坐标的纯投影
│   │   ├── mapMetrics.ts        # 三维距离、CPA、TTC、航程与禁飞盒判断
│   │   ├── sceneRenderer.ts     # 场景代理与三维无人机 Canvas 绘制
│   │   └── traffic.ts           # 实时代理避障通行权（v0.5 核心）
│   ├── globals.css              # 页面样式
│   ├── generated/               # 从 Python 结果生成的内嵌数据
│   └── data/
│       ├── sceneModels.ts       # 不参与计算的城市/灾区/农田代理模型
│       ├── python/              # 原始 timeline.csv 与 summary.json
│       └── experiments/         # experiment_bundle.json
├── scripts/
│   ├── convert_flight_log.py    # RotorPy/PyBullet 日志转换
│   ├── benchmark_onnx_model.py  # ONNX 参数/延迟/内存实测
│   ├── generate-research-data.mjs
│   ├── generate-experiment-data.mjs
│   ├── build-offline.mjs        # 生成本地单文件网站
│   └── build-pages.mjs          # 复制为Pages入口并校验内容哈希
├── .github/workflows/pages.yml  # Node.js 22生成、测试和Pages部署
├── standalone/main.tsx          # 离线版入口
├── offline/                     # 本地生成的离线构建中间文件（不提交）
├── pages-dist/                  # 本地生成的Pages部署产物（不提交）
└── README.md
```

## 6. 边界说明

- 网站用于科研讨论、方案验证和日志回放，不控制真实无人机。
- `YOLO11n`、`SegFormer-B0` 和 `Ag-YOLO` 在实时代理中代表推理环节；没有模型权重时不会伪造真实延迟或内存。
- 外部轨迹接口已经完成，但第三方物理仿真器本身没有打包进单文件网站，这是为了避免数百 MB 依赖和不同电脑上的驱动兼容问题。
- 最终任务成功率、Non-IID 精度和硬件资源指标应由课题真实实验替换演示数据。
- 内置数据均为允许公开的仿真数据；用户自行导入的外部日志与基准文件不会由网站上传。
- 本仓库暂未添加开源许可证。公开可访问不等于授权复制、修改或再发布源码。
