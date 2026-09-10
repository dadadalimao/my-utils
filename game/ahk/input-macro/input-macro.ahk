#Requires AutoHotkey v2.0
#SingleInstance Force
#UseHook
InstallKeybdHook()
InstallMouseHook()
Persistent()
SetWorkingDir A_ScriptDir

/**
 * 多路鼠标/键盘宏：每路独立热键开关（同一键启动/停止），可同时运行。
 * 热键与目标键可以相同（例如点一下 F 开始按住 F，再点一下松开）。
 *
 * 依赖：AutoHotkey v2。游戏全屏抢不到热键时，右键脚本「以管理员身份运行」。
 * 配置：同目录 config.ini，改完后用托盘「重载配置」。
 */

SendMode "Input"
SetMouseDelay -1
SetKeyDelay -1

global gApp := InputMacroApp(A_ScriptDir "\config.ini")
gApp.Start()

; ---------------------------------------------------------------------------
; 应用
; ---------------------------------------------------------------------------

class InputMacroApp {
    configPath := ""
    sendMode := "Input"
    suspendHotkey := ""
    suspendRegistered := ""
    hotkeysPaused := false
    slots := []
    registered := []

    __New(configPath) {
        this.configPath := configPath
    }

    /** 读配置、注册热键、托盘 */
    Start() {
        OnExit(this._OnExit.Bind(this))
        this._InitTray()
        if !this._LoadAndRegister() {
            return
        }
        this._RefreshTrayTip()
        TrayTip("input-macro", "已启动。小键盘减号暂停热键后可打字，再按一次恢复。", 5)
    }

    /** 托盘：打开配置 / 重载 / 全停 / 退出 */
    _InitTray() {
        A_TrayMenu.Delete()
        A_TrayMenu.Add("打开配置", this._OpenConfig.Bind(this))
        A_TrayMenu.Add("重载配置", this._Reload.Bind(this))
        A_TrayMenu.Add("暂停/恢复热键", this._ToggleSuspend.Bind(this))
        A_TrayMenu.Add()
        A_TrayMenu.Add("退出", this._Quit.Bind(this))
        A_TrayMenu.Default := "打开配置"
        A_IconTip := "input-macro"
    }

    /**
     * 解析 ini 并注册热键。失败时弹窗，不注册半套热键。
     * @returns {Boolean}
     */
    _LoadAndRegister() {
        if !FileExist(this.configPath) {
            MsgBox("找不到配置文件：`n" this.configPath, "input-macro", 16)
            return false
        }

        ini := ParseIni(this.configPath)
        general := ini.Has("general") ? ini["general"] : Map()
        this.sendMode := this._NormalizeSendMode(general.Get("send_mode", "Input"))
        this.suspendHotkey := Trim(general.Get("suspend_hotkey", ""))
        if this.suspendHotkey = ""
            this.suspendHotkey := Trim(general.Get("panic_hotkey", "NumpadSub"))
        this.hotkeysPaused := false
        this._ApplySendMode()

        this.slots := []
        usedHotkeys := Map()
        for section, kv in ini {
            if StrLower(section) = "general"
                continue
            slot := this._SlotFromIni(section, kv)
            if slot = ""
                continue
            hkNorm := StrLower(EnsureHookPrefix(slot.hotkey))
            if this.suspendHotkey != "" && hkNorm = StrLower(EnsureHookPrefix(this.suspendHotkey)) {
                TrayTip("input-macro", "[" slot.name "] 热键与暂停键冲突，已跳过", 5)
                continue
            }
            if usedHotkeys.Has(hkNorm) {
                TrayTip("input-macro", "热键重复，已跳过 [" slot.name "]：" slot.hotkey, 5)
                continue
            }
            usedHotkeys[hkNorm] := true
            this.slots.Push(slot)
        }

        if this.slots.Length = 0 {
            MsgBox("config.ini 里没有可用的宏段（[macro_xxx]）。", "input-macro", 48)
            return false
        }

        this._RegisterAll()
        return true
    }

    /**
     * 把一段 ini 转成宏槽位。字段不合法时跳过该段。
     * @returns {MacroSlot|String}
     */
    _SlotFromIni(name, kv) {
        enabled := StrLower(kv.Get("enabled", "1"))
        if enabled = "0" || enabled = "false" || enabled = "off"
            return ""

        slot := MacroSlot()
        slot.name := name
        slot.hotkey := Trim(kv.Get("toggle_hotkey", ""))
        slot.device := StrLower(Trim(kv.Get("device", "mouse")))
        slot.mode := StrLower(Trim(kv.Get("mode", "click")))
        slot.keyboardKey := Trim(kv.Get("keyboard_key", ""))
        try slot.interval := Integer(kv.Get("interval_ms", "50"))
        catch
            slot.interval := 50
        if slot.interval < 1
            slot.interval := 1

        if slot.hotkey = "" {
            TrayTip("input-macro", "[" name "] 缺少 toggle_hotkey，已跳过", 5)
            return ""
        }
        if slot.device != "mouse" && slot.device != "keyboard" {
            TrayTip("input-macro", "[" name "] device 必须是 mouse 或 keyboard，已跳过", 5)
            return ""
        }
        if slot.mode != "click" && slot.mode != "hold" {
            TrayTip("input-macro", "[" name "] mode 必须是 click 或 hold，已跳过", 5)
            return ""
        }

        if slot.device = "mouse" {
            slot.clickName := NormalizeMouseButton(kv.Get("mouse_button", "left"))
            if slot.clickName = "" {
                TrayTip("input-macro", "[" name "] mouse_button 无效，已跳过", 5)
                return ""
            }
        } else if slot.keyboardKey = "" {
            TrayTip("input-macro", "[" name "] 缺少 keyboard_key，已跳过", 5)
            return ""
        }

        slot.waitKey := StripHotkeyToWaitKey(slot.hotkey)
        if StrLen(slot.waitKey) = 1
            slot.waitKey := StrLower(slot.waitKey)
        slot.sameKey := IsSamePhysicalKey(slot)
        return slot
    }

    _RegisterAll() {
        this._UnregisterAll()
        for slot in this.slots {
            ; $ = 只响应物理按键，脚本自己 Send 的同键不会再次触发（支持热键=目标键）
            ; 单字母必须用 $f 而不是 $F，否则 AHK 可能注册失败或按了没反应
            reg := EnsureHookPrefix(slot.hotkey)
            try {
                Hotkey(reg, this._OnToggle.Bind(this, slot))
                slot.registered := reg
                this.registered.Push(reg)
            } catch as err {
                TrayTip("input-macro", "[" slot.name "] 热键注册失败：" slot.hotkey "`n" err.Message, 8)
            }
        }
        if this.suspendHotkey != "" {
            this.suspendRegistered := EnsureHookPrefix(this.suspendHotkey)
            try {
                Hotkey(this.suspendRegistered, this._ToggleSuspend.Bind(this))
                this.registered.Push(this.suspendRegistered)
            } catch as err {
                TrayTip("input-macro", "暂停热键注册失败：" this.suspendHotkey "`n" err.Message, 8)
            }
        }
    }

    _UnregisterAll() {
        for name in this.registered {
            try Hotkey(name, "Off")
        }
        this.registered := []
        for slot in this.slots
            slot.registered := ""
    }

    _ApplySendMode() {
        SendMode this.sendMode
        if this.sendMode = "Event" {
            SetMouseDelay 0
            SetKeyDelay 0
        } else {
            SetMouseDelay -1
            SetKeyDelay -1
        }
    }

    _NormalizeSendMode(raw) {
        v := StrLower(Trim(raw))
        if v = "event"
            return "Event"
        if v = "play"
            return "Play"
        return "Input"
    }

    /**
     * 同一热键开关。热键=目标键且为长按时：先等物理键松开，再补一次 down，
     * 避免「松开 F」把脚本按住的 F 一起抬起。
     */
    _OnToggle(slot, *) {
        if slot.active {
            this._StopSlot(slot)
            this._RefreshTrayTip()
            this._Notify(slot, false)
            return
        }
        this._StartSlot(slot)
        this._RefreshTrayTip()
        this._Notify(slot, true)
    }

    /**
     * 同键长按：等物理键松开后再 down 一次。
     * 若在按住时就 down，松开后再 down，记事本/输入框会连续出现两个字符。
     */
    _StartSlot(slot) {
        if slot.active
            return
        slot.active := true
        if slot.mode = "hold" {
            if slot.sameKey && slot.waitKey != ""
                KeyWait(slot.waitKey)
            if !slot.active
                return
            this._SendDown(slot)
            return
        }
        if slot.sameKey && slot.waitKey != ""
            KeyWait(slot.waitKey)
        if !slot.active
            return
        this._Fire(slot)
        slot.timer := this._Fire.Bind(this, slot)
        SetTimer(slot.timer, slot.interval)
    }

    _Notify(slot, on) {
        ToolTip((on ? "开 " : "关 ") slot.hotkey "  " SlotSummary(slot))
        SetTimer(() => ToolTip(), -1000)
    }

    _StopSlot(slot) {
        if !slot.active
            return
        slot.active := false
        if slot.timer != "" {
            SetTimer(slot.timer, 0)
            slot.timer := ""
        }
        if slot.mode = "hold"
            this._SendUp(slot)
    }

    _StopAll() {
        for slot in this.slots
            this._StopSlot(slot)
    }

    _Fire(slot, *) {
        if !slot.active
            return
        if slot.device = "mouse" {
            Click slot.clickName
            return
        }
        SendVkSc(slot.keyboardKey)
    }

    _SendDown(slot) {
        if slot.device = "mouse" {
            Click slot.clickName " Down"
            return
        }
        this._SendKeyState(slot.keyboardKey, "down")
    }

    _SendUp(slot) {
        if slot.device = "mouse" {
            Click slot.clickName " Up"
            return
        }
        this._SendKeyState(slot.keyboardKey, "up")
    }

    /** 用 vk+sc 发送，游戏比 {F down} 更容易吃到 */
    _SendKeyState(key, state) {
        SendVkSc(key, state)
    }

    /**
     * 暂停：松开所有长按，并关掉宏热键（F/W/侧键还原，可打字）。
     * 再按一次：重新打开宏热键。暂停键本身始终有效。
     */
    _ToggleSuspend(*) {
        if this.hotkeysPaused {
            for slot in this.slots {
                if slot.registered != "" {
                    try Hotkey(slot.registered, "On")
                }
            }
            this.hotkeysPaused := false
            this._RefreshTrayTip()
            ToolTip("已恢复宏热键")
            SetTimer(() => ToolTip(), -1200)
            return
        }
        this._StopAll()
        for slot in this.slots {
            if slot.registered != "" {
                try Hotkey(slot.registered, "Off")
            }
        }
        this.hotkeysPaused := true
        this._RefreshTrayTip()
        ToolTip("已暂停宏热键，可以打字")
        SetTimer(() => ToolTip(), -1200)
    }

    _Reload(*) {
        this.hotkeysPaused := false
        this._StopAll()
        this._UnregisterAll()
        if this._LoadAndRegister() {
            this._RefreshTrayTip()
            TrayTip("input-macro", "配置已重载", 3)
        }
    }

    _OpenConfig(*) {
        Run 'notepad.exe "' this.configPath '"'
    }

    _Quit(*) {
        ExitApp
    }

    _OnExit(*) {
        this._StopAll()
    }

    _RefreshTrayTip() {
        if this.hotkeysPaused {
            A_IconTip := "已暂停，可以打字`n" this.suspendHotkey " 恢复热键"
            return
        }
        lines := "input-macro"
        activeCount := 0
        for slot in this.slots {
            mark := slot.active ? "●" : "○"
            if slot.active
                activeCount += 1
            lines .= "`n" mark " " slot.hotkey "  " SlotSummary(slot)
        }
        if this.suspendHotkey != ""
            lines .= "`n暂停 " this.suspendHotkey
        A_IconTip := lines
        if activeCount > 0
            A_IconTip := "运行中 " activeCount " 路`n" lines
    }
}

class MacroSlot {
    name := ""
    hotkey := ""
    registered := ""
    device := "mouse"
    mode := "click"
    clickName := "left"
    keyboardKey := ""
    interval := 50
    sameKey := false
    waitKey := ""
    active := false
    timer := ""
}

; ---------------------------------------------------------------------------
; 工具函数
; ---------------------------------------------------------------------------

/**
 * UTF-8 ini：段名 -> 键值 Map。忽略空行与 ; # 注释。
 */
ParseIni(path) {
    text := FileRead(path, "UTF-8")
    data := Map()
    data.CaseSense := false
    section := ""
    for line in StrSplit(text, "`n", "`r") {
        line := Trim(line)
        if line = "" || SubStr(line, 1, 1) = ";" || SubStr(line, 1, 1) = "#"
            continue
        if RegExMatch(line, "^\[(.+)\]$", &m) {
            section := Trim(m[1])
            data[section] := Map()
            data[section].CaseSense := false
            continue
        }
        if section = ""
            continue
        eq := InStr(line, "=")
        if !eq
            continue
        key := Trim(SubStr(line, 1, eq - 1))
        val := Trim(SubStr(line, eq + 1))
        if key != ""
            data[section][key] := val
    }
    return data
}

/** 保证热键带 $；单字母转成小写（$f），避免 $F 注册后按了没反应 */
EnsureHookPrefix(hotkey) {
    hk := Trim(hotkey)
    if SubStr(hk, 1, 1) = "$"
        hk := SubStr(hk, 2)
    if StrLen(hk) = 1 && RegExMatch(hk, "^[A-Za-z]$")
        hk := StrLower(hk)
    return "$" hk
}

/**
 * 热键名抽成 KeyWait 可用的单键（去掉 $ ~ * 与 ^!+#<> 修饰）。
 */
StripHotkeyToWaitKey(hotkey) {
    k := Trim(hotkey)
    k := StrReplace(k, "$")
    k := StrReplace(k, "~")
    k := StrReplace(k, "*")
    while RegExMatch(k, "^[+^!#<>]")
        k := SubStr(k, 2)
    return k
}

NormalizeMouseButton(raw) {
    v := StrLower(Trim(raw))
    alias := Map(
        "left", "Left", "lbutton", "Left", "l", "Left",
        "right", "Right", "rbutton", "Right", "r", "Right",
        "middle", "Middle", "mbutton", "Middle", "m", "Middle",
        "x1", "X1", "xbutton1", "X1",
        "x2", "X2", "xbutton2", "X2"
    )
    return alias.Has(v) ? alias[v] : ""
}

/** 热键与目标是否为同一物理键（用于长按/连点补 KeyWait） */
IsSamePhysicalKey(slot) {
    hk := StrLower(StripHotkeyToWaitKey(slot.hotkey))
    if slot.device = "mouse" {
        target := Map(
            "left", "lbutton", "right", "rbutton", "middle", "mbutton",
            "x1", "xbutton1", "x2", "xbutton2"
        )
        click := StrLower(slot.clickName)
        want := target.Has(click) ? target[click] : click
        return hk = want
    }
    return hk = StrLower(Trim(slot.keyboardKey))
}

/**
 * 按虚拟键+扫描码发送。state 为空表示点一下，否则为 down/up。
 */
SendVkSc(key, state := "") {
    k := Trim(key)
    if SubStr(k, 1, 1) = "{" && SubStr(k, -1) = "}"
        k := SubStr(k, 2, StrLen(k) - 2)
    vk := GetKeyVK(k)
    sc := GetKeySC(k)
    if !vk {
        if state = ""
            Send "{" k "}"
        else
            Send "{Blind}{" k " " state "}"
        return
    }
    token := "vk" Format("{:02X}", vk) "sc" Format("{:03X}", sc)
    if state = ""
        Send "{" token "}"
    else
        Send "{Blind}{" token " " state "}"
}

SlotSummary(slot) {
    if slot.device = "mouse"
        target := slot.clickName
    else
        target := slot.keyboardKey
    mode := slot.mode = "hold" ? "长按" : "连点 " slot.interval "ms"
    return slot.device " " target " " mode
}
