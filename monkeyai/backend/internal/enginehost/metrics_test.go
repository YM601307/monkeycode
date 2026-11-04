package enginehost

import (
	"encoding/json"
	"testing"
)

func TestSystemReportValidation(t *testing.T) {
	for _, raw := range []string{
		`null`, `{}`, `{"cpu":{"logical_cores":8}}`,
		`{"cpu":{"logical_cores":8,"usage_percent":0},"memory":{"total_bytes":100,"used_bytes":10,"available_bytes":90},"disk":{"path":"/data","total_bytes":100,"used_bytes":20,"available_bytes":70}}`,
	} {
		var report *systemReport
		if err := json.Unmarshal([]byte(raw), &report); err != nil || !validSystem(report) {
			t.Fatalf("合法报告或旧版缺省报告被拒绝: %s %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"hostname":"bad\nname"}`, `{"cpu":{"logical_cores":0}}`, `{"cpu":{"logical_cores":8,"usage_percent":101}}`,
		`{"cpu":{"logical_cores":8,"usage_percent":-1}}`, `{"memory":{"total_bytes":0}}`,
		`{"memory":{"total_bytes":100,"used_bytes":101}}`, `{"memory":{"total_bytes":100,"used_bytes":20,"available_bytes":90}}`,
		`{"disk":{"path":"relative","total_bytes":100}}`, `{"disk":{"path":"/data","total_bytes":100,"used_bytes":-1}}`,
	} {
		var report *systemReport
		if err := json.Unmarshal([]byte(raw), &report); err == nil && validSystem(report) {
			t.Fatalf("接受了无效宿主指标: %s", raw)
		}
	}
}
