package enginehost

import (
	"math"
	"strings"
)

type systemReport struct {
	Hostname      string        `json:"hostname"`
	OSName        string        `json:"os_name"`
	KernelVersion string        `json:"kernel_version"`
	CPU           *cpuReport    `json:"cpu"`
	Memory        *memoryReport `json:"memory"`
	Disk          *diskReport   `json:"disk"`
}

type cpuReport struct {
	Model        string   `json:"model"`
	LogicalCores int      `json:"logical_cores"`
	UsagePercent *float64 `json:"usage_percent"`
}

type memoryReport struct {
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
}

type diskReport struct {
	Path string `json:"path"`
	memoryReport
}

func validSystem(s *systemReport) bool {
	if s == nil {
		return true
	}
	text := func(value string, limit int) bool {
		return len(value) <= limit && !strings.ContainsAny(value, "\x00\r\n")
	}
	if !text(s.Hostname, 255) || !text(s.OSName, 256) || !text(s.KernelVersion, 256) {
		return false
	}
	if cpu := s.CPU; cpu != nil {
		if !text(cpu.Model, 512) || cpu.LogicalCores < 1 || cpu.LogicalCores > 1<<20 {
			return false
		}
		if cpu.UsagePercent != nil && (math.IsNaN(*cpu.UsagePercent) || math.IsInf(*cpu.UsagePercent, 0) || *cpu.UsagePercent < 0 || *cpu.UsagePercent > 100) {
			return false
		}
	}
	validMemory := func(m *memoryReport) bool {
		return m == nil || (m.TotalBytes > 0 && m.UsedBytes <= m.TotalBytes && m.AvailableBytes <= m.TotalBytes-m.UsedBytes)
	}
	if !validMemory(s.Memory) {
		return false
	}
	return s.Disk == nil || (text(s.Disk.Path, 4096) && strings.HasPrefix(s.Disk.Path, "/") && validMemory(&s.Disk.memoryReport))
}
