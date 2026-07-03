package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all configuration for the API Gateway
type Config struct {
	Server   ServerConfig
	CORS     CORSConfig
	RateLimit RateLimitConfig
	Auth     AuthConfig
	Services ServicesConfig
	Upload   UploadConfig
}

type ServerConfig struct {
	Port         string
	Mode         string
	Env          string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

type CORSConfig struct {
	AllowedOrigins []string
	AllowedMethods []string
	AllowedHeaders []string
	MaxAge         int
}

type RateLimitConfig struct {
	Enabled        bool
	UserRateLimit  float64
	UserBurst      int
	IPRateLimit    float64
	IPBurst        int
	CleanupInterval time.Duration
}

type AuthConfig struct {
	Enabled     bool
	JWTSecret   string
	TokenExpiry time.Duration
	SkipPaths   []string
}

type ServicesConfig struct {
	UserService        string
	ProjectService     string
	TranslationService string
	ImageService       string
	ExportService      string
	ReaderService      string
	AIGateway          string
	NotificationService string
}

type UploadConfig struct {
	MaxImageSize   int64
	MaxArchiveSize int64
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if value, ok := os.LookupEnv(key); ok {
		if v, err := strconv.Atoi(value); err == nil {
			return v
		}
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if value, ok := os.LookupEnv(key); ok {
		if v, err := strconv.ParseInt(value, 10, 64); err == nil {
			return v
		}
	}
	return fallback
}

func getEnvFloat64(key string, fallback float64) float64 {
	if value, ok := os.LookupEnv(key); ok {
		if v, err := strconv.ParseFloat(value, 64); err == nil {
			return v
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if value, ok := os.LookupEnv(key); ok {
		if v, err := time.ParseDuration(value); err == nil {
			return v
		}
	}
	return fallback
}

// Load reads configuration from environment variables
func Load() *Config {
	cfg := &Config{
		Server: ServerConfig{
			Port:         getEnv("SERVER_PORT", "8080"),
			Mode:         getEnv("GIN_MODE", "debug"),
			Env:          getEnv("APP_ENV", "development"),
			ReadTimeout:  getEnvDuration("SERVER_READ_TIMEOUT", 300*time.Second),
			WriteTimeout: getEnvDuration("SERVER_WRITE_TIMEOUT", 300*time.Second),
			IdleTimeout:  getEnvDuration("SERVER_IDLE_TIMEOUT", 120*time.Second),
		},
		CORS: CORSConfig{
			AllowedOrigins: strings.Split(getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173"), ","),
			AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
			AllowedHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-ID", "Idempotency-Key"},
			MaxAge:         getEnvInt("CORS_MAX_AGE", 86400),
		},
		RateLimit: RateLimitConfig{
			Enabled:         getEnv("RATE_LIMIT_ENABLED", "true") == "true",
			UserRateLimit:   getEnvFloat64("RATE_LIMIT_USER_RPS", 100.0/60.0),
			UserBurst:       getEnvInt("RATE_LIMIT_USER_BURST", 20),
			IPRateLimit:     getEnvFloat64("RATE_LIMIT_IP_RPS", 300.0/60.0),
			IPBurst:         getEnvInt("RATE_LIMIT_IP_BURST", 50),
			CleanupInterval: 5 * time.Minute,
		},
		Auth: AuthConfig{
			Enabled:     getEnv("AUTH_ENABLED", "true") == "true",
			JWTSecret:   getEnv("JWT_SECRET_KEY", "dev-secret-key-change-in-production"),
			TokenExpiry: getEnvDuration("JWT_ACCESS_TOKEN_EXPIRE", 2*time.Hour),
			SkipPaths: []string{
				"/api/v1/auth/register",
				"/api/v1/auth/login",
				"/api/v1/auth/refresh",
				"/api/v1/payments/notify",       // 支付网关异步回调（无用户 token，靠签名验证）
				"/api/v1/payments/sandbox/",     // 沙箱模拟支付页/确认（未配置真实网关时）
				"/api/v1/ws/",          // WebSocket 连接路径（无 Authorization header）
				"/health",
				"/metrics",
				"/storage/",           // 静态文件存储路径（浏览器 img 标签请求无 Auth header）
				"/uploads/",           // 处理后图片存储路径（inpaint/render 回退）
				"/api/v1/external/",    // 开放平台外部 API（由 user-service 的 API Key 依赖鉴权，非 JWT）
				"/api/v1/fonts/file/",  // 字体文件二进制流（@font-face 直接加载，浏览器不附加 Authorization）
			},
		},
		Services: ServicesConfig{
			UserService:         getEnv("USER_SERVICE_URL", "http://user-service:8001"),
			ProjectService:      getEnv("PROJECT_SERVICE_URL", "http://project-service:8002"),
			TranslationService:  getEnv("TRANSLATION_SERVICE_URL", "http://translation-service:8003"),
			ImageService:        getEnv("IMAGE_SERVICE_URL", "http://image-service:8004"),
			ExportService:       getEnv("EXPORT_SERVICE_URL", "http://export-service:8005"),
			ReaderService:       getEnv("READER_SERVICE_URL", "http://reader-service:8006"),
			AIGateway:           getEnv("AI_GATEWAY_URL", "http://ai-gateway:8100"),
			NotificationService: getEnv("NOTIFICATION_SERVICE_URL", "http://notification-service:8007"),
		},
		Upload: UploadConfig{
			MaxImageSize:   getEnvInt64("MAX_IMAGE_SIZE_BYTES", 50*1024*1024),
			MaxArchiveSize: getEnvInt64("MAX_ARCHIVE_SIZE_BYTES", 500*1024*1024),
		},
	}
	return cfg
}
