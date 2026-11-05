# 16G 系统字体与字形合同

状态：开发前合同，用户未验收。范围：外观中的界面/内容/代码字体、字形、本地字体加载与默认/fallback；不扩展其他设置页。

## 来源与边界

固定官方Store 26.1027.3384.0；复用16F已经复核的整个asar SHA。新提取的entry integrity、哈希、0-based UTF-16检索锚点见 `.ref/parity/16/actual/16G-fonts/reference/`。

- `early-bootstrap-491-e75c34fa1b2c0832.js` 的 `eb0.getFontFamilies@3638460` 直接返回 Electron `systemPreferences.getFontFamilies()`。没有发现应用层排序；目录实际顺序及平台覆盖仍需官方运行时对照。
- `general-settings-5e6e6ad31bf0.js` 的 `bo`/`go`/`xo`/`So`：目录只读缓存、不自动重试；字体匹配忽略大小写、默认取faces[0]；代码字体只显示faces.every(isMonospaced)；选family保存带CSS引号的family，清除face；选非首face保存family/fullName/postscriptName。内容默认值为“与界面字体相同”，UI/代码默认“系统”。
- 同版本 `theme-font-face-loader` 使用 `Codex selected ${postscriptName}` 别名与local(PostScript)/local(fullName)，load成功后加入document.fonts；CSS别名置前接原family。不得把带引号的CSS family再次整体JSON.stringify，不能把完整字体fallback列表作为一个字体名。
- 目录不可用时保留菜单内自定义CSS值输入与“使用自定义字体值”，而不是虚构安装字体。已保存但不在目录的自定义值保留，字形控件禁用。搜索不是本轮静态实现发现的控件，不自行增加。

原生路径采用现有Windows SDK DirectWrite系统字体目录、字体信息与等宽标志，不新增包、不遍历用户项目、不提供任意文件读取接口。Microsoft官方依据：[字体枚举](https://learn.microsoft.com/en-us/windows/win32/directwrite/font-enumeration)、[等宽标志](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_1/nf-dwrite_1-idwritefont1-ismonospacedfont)。它是否与此Electron目录完全相同仍需配对核验，不预先承诺顺序一致。

### Windows默认face适配（实现中发现并登记）

原始DirectWrite集合中，Segoe UI首项为Light，而省略face元数据时CSS normal使用Regular；直接转发会导致菜单标签与实际字体不一致。适配层使用 `GetFirstMatchingFont(normal,normal,normal)` 的真实默认匹配face为首，其余保留原相对顺序；无法定位时保留原序，不按英文Regular名称猜测。前端仍原样保留服务目录顺序。这是为默认CSS语义进行的适配，尚未证明是官方Electron排序；分组、locale、变量字体覆盖和顺序保持待配对项。

## 修改前验收

| ID | 操作 | 预期 |
|---|---|---|
| AGF01 | 原生读取目录 | 返回真实family及faces的fullName/postscriptName/styleName/isMonospaced；不请求模型、不写配置 |
| AGF02 | 界面/内容/代码默认选项 | 内容随UI；其余系统默认；恢复默认清除对应face且保留其他主题字段 |
| AGF03 | 选择字体族 | 用目录中的首face语义，保存正确CSS family并读回；不遗留之前family的face |
| AGF04 | 选择字形 | 首face清除face元数据，其他face保留三个标识；style显示目录styleName |
| AGF05 | 代码字体 | 所有face均等宽才列入，混合family排除；无有效family时字形禁用 |
| AGF06 | 目录加载/失败/空集合 | 读取期显示加载状态；失败/空进入官方自定义值fallback；不把失败写成成功枚举 |
| AGF07 | 本地字体加载 | local PostScript/fullName，别名CSS，失败保留family fallback；晚到加载不替换当前选择 |
| AGF08 | 菜单键盘、IME、宽窄 | 方向键/Enter选择，Escape归焦，输入IME不提交；1280/640无溢出 |

复用GeneralPreferenceSelect和真实主题保存队列；目录请求晚到不得触发写入或跨窗口状态污染。清理仅删除本轮替换造成的字体手工行与无用分支。新回归先暴露旧实现缺口，再实现与验证。

无官方同条件截图、原生物理IME和用户验收前，不称外观整页或字体1:1完成。
