/**
 * 统一导航栏组件
 * 在每个工具页面中引入此JS文件，即可自动添加导航栏
 */

(function () {
    // 工具列表配置
    const tools = [
        { id: 'index', name: '工具首页', file: 'index.html', icon: '🏠' },
        { id: 'stringGetCity', name: '地址解析工具', file: 'stringGetCity.html', icon: '🗺️' },
        { id: 'svgPng', name: 'SVG转换工具', file: 'svg-png.html', icon: '🖼️' },
        { id: 'wordToHtml', name: 'Word文档转换器', file: 'wordToHtml.html', icon: '📄' },
        { id: 'wordToRich', name: '富文本转换器', file: 'wordToRich.html', icon: '✍️' },
        { id: 'objArrayToExcel', name: '数组转Excel生成器', file: 'objArrayToExcel.html', icon: '📊' },
        { id: 'batchCanvas', name: '图片批量画布处理器', file: '批量画布调整.html', icon: '🖌️' }
    ];

    // 创建导航栏样式
    function createNavStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #my-utils-nav {
                background-color: #f8f9fa;
                border-bottom: 1px solid #e9ecef;
                padding: 10px 15px;
                margin-bottom: 20px;
                font-family: Arial, sans-serif;
            }
            #my-utils-nav .nav-container {
                max-width: 1200px;
                margin: 0 auto;
                display: flex;
                flex-direction: column;
            }
            #my-utils-nav .nav-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            #my-utils-nav .nav-title {
                font-size: 1.25rem;
                font-weight: bold;
                margin: 0;
            }
            #my-utils-nav .nav-toggle {
                display: none;
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
            }
            #my-utils-nav .nav-links {
                display: flex;
                flex-wrap: wrap;
                list-style: none;
                margin: 0;
                padding: 0;
            }
            #my-utils-nav .nav-links li {
                margin-right: 5px;
                margin-bottom: 5px;
            }
            #my-utils-nav .nav-links a {
                display: inline-block;
                padding: 6px 12px;
                text-decoration: none;
                color: #212529;
                background-color: #fff;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                transition: all 0.2s ease-in-out;
            }
            #my-utils-nav .nav-links a:hover {
                background-color: #e9ecef;
            }
            #my-utils-nav .nav-links a.active {
                background-color: #0d6efd;
                color: white;
                border-color: #0d6efd;
            }
            @media (max-width: 768px) {
                #my-utils-nav .nav-toggle {
                    display: block;
                }
                #my-utils-nav .nav-links {
                    display: none;
                    flex-direction: column;
                    width: 100%;
                }
                #my-utils-nav .nav-links.show {
                    display: flex;
                }
                #my-utils-nav .nav-links li {
                    margin-right: 0;
                    margin-bottom: 5px;
                    width: 100%;
                }
                #my-utils-nav .nav-links a {
                    display: block;
                    width: 100%;
                }
            }
        `;
        return style;
    }

    // 创建导航栏HTML
    function createNavHTML() {
        // 获取当前页面的文件名
        const currentPath = window.location.pathname;
        const currentPage = currentPath.substring(currentPath.lastIndexOf('/') + 1);

        const nav = document.createElement('div');
        nav.id = 'my-utils-nav';

        const container = document.createElement('div');
        container.className = 'nav-container';

        // 创建导航头部
        const header = document.createElement('div');
        header.className = 'nav-header';

        const title = document.createElement('h1');
        title.className = 'nav-title';
        title.textContent = 'My Utils 工具集';

        const toggle = document.createElement('button');
        toggle.className = 'nav-toggle';
        toggle.textContent = '☰';
        toggle.setAttribute('aria-label', '切换导航菜单');
        toggle.onclick = function () {
            const links = document.querySelector('#my-utils-nav .nav-links');
            links.classList.toggle('show');
        };

        header.appendChild(title);
        header.appendChild(toggle);

        // 创建导航链接
        const linksList = document.createElement('ul');
        linksList.className = 'nav-links';

        tools.forEach(tool => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = tool.file;
            link.textContent = `${tool.icon} ${tool.name}`;

            // 标记当前活动页面
            if (tool.file === currentPage ||
                (currentPage === '' && tool.id === 'index')) {
                link.className = 'active';
            }

            listItem.appendChild(link);
            linksList.appendChild(listItem);
        });

        container.appendChild(header);
        container.appendChild(linksList);
        nav.appendChild(container);

        return nav;
    }

    // 插入导航栏到页面中
    function insertNav() {
        const styles = createNavStyles();
        const navElement = createNavHTML();

        // 插入到body的最前面
        document.body.insertBefore(navElement, document.body.firstChild);
        document.head.appendChild(styles);
    }

    // 页面加载完成后插入导航栏
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', insertNav);
    } else {
        insertNav();
    }
})(); 