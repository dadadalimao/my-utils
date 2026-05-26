@{
    Id             = 'stp'
    Name           = '智慧水务后端'
    DefaultRoot    = 'E:\sxhwork\java\sewage-treatment-plant-service'
    DefaultProfile = 'dao,dev'
    Modules        = @{
        admin = @{
            Label        = '管理端 API'
            GradleTask   = ':admin:bootJar'
            JarRelPath   = 'admin\build\libs\admin.jar'
            Port         = 8080
            WatchModules = @('admin', 'dao', 'common', 'attachment')
        }
        'prec-aer' = @{
            Label        = '曝气服务'
            GradleTask   = ':prec-aer:bootJar'
            JarRelPath   = 'prec-aer\build\libs\prec-aer.jar'
            Port         = $null
            WatchModules = @('prec-aer', 'dao', 'common')
        }
    }
}
