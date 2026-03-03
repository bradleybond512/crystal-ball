# Makefile for the Crystal Ball OSINT Go engine
# Usage:
#   make build        — compile for the current platform
#   make build-all    — cross-compile for all supported targets
#   make test         — run unit tests
#   make clean        — remove compiled binaries

BINARY_NAME := osint-engine
BUILD_DIR   := ../sidecar
GO_MODULE   := github.com/bradleybond512/crystal-ball/osint

LDFLAGS := -s -w
GO_BUILD := go build -ldflags="$(LDFLAGS)" -trimpath

.PHONY: all build build-all test clean deps tidy

all: deps test build

## deps — download and verify Go module dependencies
deps:
	go mod download
	go mod verify

## tidy — tidy go.mod / go.sum
tidy:
	go mod tidy

## build — compile osint-engine for the host platform and place it in sidecar/
build: deps
	$(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME) ./...
	@echo "Built $(BUILD_DIR)/$(BINARY_NAME)"

## build-all — cross-compile for macOS (arm64+amd64), Linux (amd64), Windows (amd64)
build-all: deps
	GOOS=darwin  GOARCH=arm64 $(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME)-aarch64-apple-darwin       .
	GOOS=darwin  GOARCH=amd64 $(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME)-x86_64-apple-darwin        .
	GOOS=linux   GOARCH=amd64 $(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME)-x86_64-unknown-linux-gnu   .
	GOOS=linux   GOARCH=arm64 $(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME)-aarch64-unknown-linux-gnu  .
	GOOS=windows GOARCH=amd64 $(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME)-x86_64-pc-windows-msvc.exe .
	@echo "Cross-compiled all targets into $(BUILD_DIR)/"

## test — run all Go tests
test:
	go test ./... -v -count=1

## clean — remove compiled binaries from the sidecar directory
clean:
	rm -f $(BUILD_DIR)/$(BINARY_NAME)
	rm -f $(BUILD_DIR)/$(BINARY_NAME)-*
	@echo "Cleaned up binaries"
