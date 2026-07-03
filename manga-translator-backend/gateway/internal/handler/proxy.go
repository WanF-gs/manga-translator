package handler

import (
	"io"
	"log"
	"manga-translator/gateway/internal/service"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// sharedTransport is the single HTTP transport reused across all proxied requests.
// Connection pooling (keep-alive) works correctly because the Transport is long-lived.
var sharedTransport = &http.Transport{
	DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
	TLSHandshakeTimeout:   10 * time.Second,
	ResponseHeaderTimeout: 30 * time.Second,
	IdleConnTimeout:       90 * time.Second,
	MaxIdleConns:          200,
	MaxIdleConnsPerHost:   50,
}

// ProxyHandler handles reverse proxying to microservices.
type ProxyHandler struct {
	discovery *service.Discovery
}

// NewProxyHandler creates a new proxy handler
func NewProxyHandler(discovery *service.Discovery) *ProxyHandler {
	return &ProxyHandler{discovery: discovery}
}

// ProxyToService returns a handler that reverse-proxies to the named service.
func (h *ProxyHandler) ProxyToService(serviceName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		serviceURL, ok := h.discovery.GetServiceURL(serviceName)
		if !ok {
			c.JSON(http.StatusBadGateway, gin.H{
				"code":    5001,
				"message": "Service not found: " + serviceName,
				"data":    nil,
			})
			return
		}

		// WebSocket upgrade — raw TCP relay
		if strings.ToLower(c.GetHeader("Upgrade")) == "websocket" {
			h.proxyWebSocket(c, serviceURL)
			return
		}

		target, err := url.Parse(serviceURL)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"code":    5001,
				"message": "Invalid service URL",
				"data":    nil,
			})
			return
		}

		// Each request gets its own ReverseProxy instance. Reusing a shared
		// ReverseProxy and mutating its Director/ModifyResponse closures across
		// goroutines leads to "concurrent map writes" crashes because one request's
		// ServeHTTP may execute another request's closure, both writing to the
		// same gin Context's response header map.
		proxy := &httputil.ReverseProxy{
			Transport: sharedTransport,
			Director: func(req *http.Request) {
				req.URL.Scheme = target.Scheme
				req.URL.Host = target.Host
				req.URL.Path = c.Request.URL.Path
				req.URL.RawQuery = c.Request.URL.RawQuery
				req.Host = target.Host

				if userID, exists := c.Get("user_id"); exists {
					req.Header.Set("X-User-ID", userID.(string))
				}
				if planType, exists := c.Get("plan_type"); exists {
					req.Header.Set("X-Plan-Type", planType.(string))
				}

				requestID := c.GetHeader("X-Request-ID")
				if requestID == "" {
					requestID = uuid.New().String()
				}
				req.Header.Set("X-Request-ID", requestID)
				c.Header("X-Request-ID", requestID)
			},
			ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
				log.Printf("[PROXY] %s %s → %s  error=%v", c.Request.Method, c.Request.URL.Path, serviceName, err)
				msg := `{"code":5001,"message":"Upstream service unavailable","data":null}`
				if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
					msg = `{"code":5001,"message":"后端服务响应超时，请稍后重试","data":null}`
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				w.Write([]byte(msg))
			},
			ModifyResponse: func(resp *http.Response) error {
				if resp.StatusCode == http.StatusSwitchingProtocols {
					return nil
				}
				resp.Header.Del("Access-Control-Allow-Origin")
				resp.Header.Del("Access-Control-Allow-Methods")
				resp.Header.Del("Access-Control-Allow-Headers")
				resp.Header.Del("Access-Control-Expose-Headers")
				resp.Header.Del("Access-Control-Max-Age")
				resp.Header.Del("Access-Control-Allow-Credentials")
				resp.Header.Set("X-Request-ID", c.GetHeader("X-Request-ID"))
				resp.Header.Set("X-Gateway-Timestamp", time.Now().UTC().Format(time.RFC3339))
				return nil
			},
		}

		start := time.Now()
		proxy.ServeHTTP(c.Writer, c.Request)
		elapsed := time.Since(start)
		log.Printf("[PROXY] %s %s → %s  %d  %dms",
			c.Request.Method, c.Request.URL.Path, serviceName,
			c.Writer.Status(), elapsed.Milliseconds())
	}
}

func (h *ProxyHandler) proxyWebSocket(c *gin.Context, backendURL string) {
	target, err := url.Parse(backendURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": 5001, "message": "Invalid backend URL", "data": nil})
		return
	}

	backendAddr := target.Host
	if target.Port() == "" {
		if target.Scheme == "https" {
			backendAddr += ":443"
		} else {
			backendAddr += ":80"
		}
	}

	dialer := net.Dialer{Timeout: 10 * time.Second}
	backendConn, err := dialer.DialContext(c.Request.Context(), "tcp", backendAddr)
	if err != nil {
		log.Printf("[WS] Failed to dial backend %s: %v", backendAddr, err)
		c.JSON(http.StatusBadGateway, gin.H{"code": 5001, "message": "无法连接通知服务", "data": nil})
		return
	}
	defer backendConn.Close()

	hijacker, ok := c.Writer.(http.Hijacker)
	if !ok {
		log.Printf("[WS] Hijacker not supported")
		c.JSON(http.StatusInternalServerError, gin.H{"code": 5001, "message": "WebSocket not supported", "data": nil})
		return
	}
	clientConn, clientBuf, err := hijacker.Hijack()
	if err != nil {
		log.Printf("[WS] Hijack failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": 5001, "message": "Connection upgrade failed", "data": nil})
		return
	}
	defer clientConn.Close()

	req := c.Request
	req.URL.Scheme = target.Scheme
	req.URL.Host = target.Host
	req.Host = target.Host
	req.RequestURI = ""

	removeHopByHopHeaders(req.Header)

	if err := req.Write(backendConn); err != nil {
		log.Printf("[WS] Failed to write request to backend: %v", err)
		return
	}

	if clientBuf != nil && clientBuf.Reader != nil {
		clientBuf.Flush()
	}

	done := make(chan struct{}, 2)
	go func() {
		io.Copy(backendConn, clientConn)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(clientConn, backendConn)
		done <- struct{}{}
	}()
	<-done

	log.Printf("[WS] WebSocket connection closed for %s", c.Request.URL.Path)
}

var hopHeaders = []string{
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Te",
	"Trailers",
	"Transfer-Encoding",
}

func removeHopByHopHeaders(header http.Header) {
	for _, h := range hopHeaders {
		header.Del(h)
	}
	if header.Get("Upgrade") != "" {
		header.Set("Connection", "Upgrade")
	}
}

// AutoProxy automatically resolves the target service based on the path
func (h *ProxyHandler) AutoProxy() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		routes := map[string]string{
			"/api/v1/auth/":      "user-service",
			"/api/v1/user/":      "user-service",
			"/api/v1/projects/":  "project-service",
			"/api/v1/chapters/":  "project-service",
			"/api/v1/presets/":   "project-service",
			"/api/v1/trash/":     "project-service",
			"/api/v1/terms/":     "translation-service",
			"/api/v1/memory/":    "translation-service",
			"/api/v1/export/":    "export-service",
			"/api/v1/reader/":    "reader-service",
		}

		if path == "/api/v1/pages" || strings.HasPrefix(path, "/api/v1/pages/") {
			if path == "/api/v1/pages" {
				h.ProxyToService("project-service")(c)
				return
			}
			parts := strings.Split(strings.TrimPrefix(path, "/api/v1/pages/"), "/")
			if len(parts) >= 2 {
				op := parts[1]
				switch op {
				case "detect", "ocr", "inpaint", "render", "enhance", "batch-process", "preprocess":
					h.ProxyToService("image-service")(c)
					return
				case "translate":
					h.ProxyToService("translation-service")(c)
					return
				case "export":
					h.ProxyToService("export-service")(c)
					return
				case "regions", "status", "sort", "retry", "undo", "redo", "history", "undo-status",
					"moderate", "moderation-status", "content-review":
					h.ProxyToService("project-service")(c)
					return
				}
			}
			h.ProxyToService("project-service")(c)
			return
		}

		for prefix, serviceName := range routes {
			if strings.HasPrefix(path, prefix) {
				h.ProxyToService(serviceName)(c)
				return
			}
		}

		c.JSON(http.StatusNotFound, gin.H{
			"code":    1002,
			"message": "Route not found",
			"data":    nil,
		})
	}
}
