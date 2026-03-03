// Package storage implements structured logging for OSINT operations.
package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	logFilePath    = "~/Library/Logs/crystal-ball/osint.log"
	maxLogFileSize = 5 * 1024 * 1024 // 5 MB
)

// Logger writes structured log entries to the OSINT log file.
type Logger struct {
	mu   sync.Mutex
	file *os.File
}

// NewLogger opens (or creates) the OSINT log file.
func NewLogger() (*Logger, error) {
	logPath, err := expandLogPath()
	if err != nil {
		return nil, fmt.Errorf("resolve log path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}
	return &Logger{file: f}, nil
}

// Close flushes and closes the log file.
func (l *Logger) Close() {
	if l != nil && l.file != nil {
		_ = l.file.Sync()
		_ = l.file.Close()
	}
}

// Info logs an informational message.
func (l *Logger) Info(msg string, kvs ...string) {
	l.log("INFO", msg, kvs...)
}

// Warn logs a warning message.
func (l *Logger) Warn(msg string, kvs ...string) {
	l.log("WARN", msg, kvs...)
}

// Error logs an error message.
func (l *Logger) Error(msg string, kvs ...string) {
	l.log("ERROR", msg, kvs...)
}

func (l *Logger) log(level, msg string, kvs ...string) {
	if l == nil {
		return
	}
	ts := time.Now().UTC().Format(time.RFC3339)
	line := fmt.Sprintf("[%s][%s] %s", ts, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		line += fmt.Sprintf(" %s=%q", kvs[i], kvs[i+1])
	}
	line += "\n"

	l.mu.Lock()
	defer l.mu.Unlock()

	var w io.Writer = os.Stderr
	if l.file != nil {
		w = l.file
	}
	_, _ = fmt.Fprint(w, line)
}

func expandLogPath() (string, error) {
	logPath := logFilePath
	if len(logPath) >= 2 && logPath[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			// Non-macOS fallback
			logPath = "/tmp/crystal-ball-osint.log"
			return logPath, nil
		}
		return filepath.Join(home, logPath[2:]), nil
	}
	return logPath, nil
}
