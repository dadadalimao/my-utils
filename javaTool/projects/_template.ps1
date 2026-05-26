<#
新增项目步骤：
1. 复制本文件为 projects/my-app.ps1（文件名可任意，勿以 _ 开头）
2. 修改 Id、Name、DefaultRoot、Modules（每个模块建议配置 Port）
3. 重启 GUI，列表中自动出现新项目的各模块行

返回的 hashtable 字段说明：
- Id             项目唯一标识（英文短名）
- Name           GUI 显示名称
- DefaultRoot    Gradle 项目根目录
- DefaultProfile 默认 spring.profiles.active
- Modules        模块表，键为模块 Id
    Label        显示名
    GradleTask   bootJar 任务，如 :admin:bootJar
    JarRelPath   相对 DefaultRoot 的 jar 路径
    Port         监听端口（无固定端口可 $null）
    WatchModules 增量编译扫描的子模块目录名
#>
@{
    Id             = 'my-app'
    Name           = '我的项目'
    DefaultRoot    = 'D:\path\to\gradle-project'
    DefaultProfile = 'dev'
    Modules        = @{
        api = @{
            Label        = 'API 服务'
            GradleTask   = ':api:bootJar'
            JarRelPath   = 'api\build\libs\api.jar'
            Port         = 8080
            WatchModules = @('api', 'common')
        }
    }
}
