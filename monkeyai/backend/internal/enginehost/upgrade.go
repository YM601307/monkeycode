package enginehost

import (
	_ "embed"
	"fmt"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"net/url"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

//go:embed upgrade.sh
var upgrader []byte

func (s *Service) upgradeCommand(w http.ResponseWriter, r *http.Request) {
	if !secureServer(s.server) {
		fail(w, r, 503, "请先配置宿主可访问的 HTTPS 服务地址")
		return
	}
	for _, arch := range []string{"amd64", "arm64"} {
		m, _, err := s.manifest(s.version, arch)
		if err != nil || m.Files["dockerd"] == "" || m.Files["installer"] == "" {
			fail(w, r, 503, "服务器缺少完整的 Docker engine 升级资源")
			return
		}
	}
	address := s.server + "/api/host/v1/upgrade.sh?version=" + url.QueryEscape(s.version)
	command := "sudo bash -c \"$(curl -kfsSL " + quote(address) + " || echo 'exit 1')\""
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]string{"version": s.version, "command": command})
}
func (s *Service) upgradeScript(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !secureServer(s.server) {
		http.Error(w, web.Message(r.Context(), "", "后台 HTTPS 地址无效"), 503)
		return
	}
	version := r.URL.Query().Get("version")
	if version == "" {
		version = s.version
	}
	if !versionPattern.MatchString(version) || version == "latest" {
		http.Error(w, web.Message(r.Context(), "", "升级版本无效"), 400)
		return
	}
	var body strings.Builder
	body.WriteString("#!/bin/bash\nupgrade_engine() {\ncase \"$(uname -m)\" in\n")
	for _, arch := range []string{"amd64", "arm64"} {
		m, raw, err := s.manifest(version, arch)
		if err != nil || m.Files["dockerd"] == "" || m.Files["installer"] == "" {
			http.Error(w, web.Message(r.Context(), "", "服务器缺少完整的 Docker engine 升级资源"), 503)
			return
		}
		pattern := "x86_64|amd64"
		if arch == "arm64" {
			pattern = "aarch64|arm64"
		}
		args := []string{s.server, version, arch, m.Files["installer"], hash(raw)}
		for i := range args {
			args[i] = quote(args[i])
		}
		fmt.Fprintf(&body, "%s) set -- %s ;;\n", pattern, strings.Join(args, " "))
	}
	body.WriteString("*) echo '仅支持 amd64 / arm64' >&2; return 1 ;;\nesac\n")
	body.Write(upgrader)
	body.WriteString("\n}\nupgrade_engine\n")
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write([]byte(body.String()))
}
