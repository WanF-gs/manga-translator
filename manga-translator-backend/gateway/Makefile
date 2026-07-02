.PHONY: run build clean test

APP_NAME=gateway
BUILD_DIR=./bin

run:
	go run ./cmd/main.go

build:
	go build -o $(BUILD_DIR)/$(APP_NAME) ./cmd/main.go

clean:
	rm -rf $(BUILD_DIR)

test:
	go test ./...

mod:
	go mod tidy
	go mod download

docker-build:
	docker build -t manga-translator-gateway:latest .

docker-run:
	docker run -p 8080:8080 --env-file .env manga-translator-gateway:latest
