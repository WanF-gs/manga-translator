package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// Logger returns a request logging middleware
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method

		// Process request
		c.Next()

		// Calculate latency
		latency := time.Since(start)
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = c.Writer.Header().Get("X-Request-ID")
		}

		log.Printf("[GATEWAY] %s | %3d | %13v | %15s | %-7s %s | request_id=%s",
			time.Now().Format("2006-01-02 15:04:05.000"),
			statusCode,
			latency,
			clientIP,
			method,
			path,
			requestID,
		)
	}
}
