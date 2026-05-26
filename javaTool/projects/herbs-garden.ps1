@{
    Id             = 'herbs-garden'
    Name           = '百草园后端'
    DefaultRoot    = 'E:\sxhwork\herbs-garden-service'
    DefaultProfile = 'dao,dev'
    Modules        = @{
        admin = @{
            Label        = '管理端 API'
            GradleTask   = ':admin:bootJar'
            JarRelPath   = 'admin\build\libs\admin.jar'
            Port         = 8080
            WatchModules = @('admin', 'dao', 'common', 'attachment')
        }
    }
}
