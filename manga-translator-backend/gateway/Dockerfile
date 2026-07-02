FROM golang:1.21-alpine AS builder

ENV GOPROXY=https://goproxy.cn,https://goproxy.io,direct
ENV CGO_ENABLED=0
ENV GOOS=linux

WORKDIR /app

# 先只拷贝依赖声明文件，利用 Docker 层缓存
COPY gateway/go.mod ./
RUN go mod download

# 再拷贝业务代码并构建
COPY gateway/ ./
RUN go mod tidy && go build -o gateway ./cmd/main.go

FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app
COPY --from=builder /app/gateway .

EXPOSE 8080

CMD ["./gateway"]
