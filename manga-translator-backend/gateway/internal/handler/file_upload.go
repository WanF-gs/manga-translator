package handler

import (
	"manga-translator/gateway/internal/config"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// FileUploadHandler handles file upload requests
type FileUploadHandler struct {
	cfg *config.Config
}

// NewFileUploadHandler creates a new file upload handler
func NewFileUploadHandler(cfg *config.Config) *FileUploadHandler {
	return &FileUploadHandler{cfg: cfg}
}

// UploadMiddleware validates upload size limits
func (h *FileUploadHandler) UploadMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		contentType := c.GetHeader("Content-Type")

		// Only check multipart uploads
		if len(contentType) >= 9 && contentType[:9] == "multipart" {
			// Check Content-Length
			contentLength := c.Request.ContentLength
			if contentLength <= 0 {
				c.Next()
				return
			}

			maxSize := h.cfg.Upload.MaxImageSize

			// Check if it's an archive upload (path contains "upload-archive" or ends with archive extension)
			path := c.Request.URL.Path
			if strings.Contains(path, "upload-archive") || isArchiveExt(path) {
				maxSize = h.cfg.Upload.MaxArchiveSize
			}

			if contentLength > maxSize {
				c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
					"code":    4002,
					"message": "File size exceeds limit",
					"data": gin.H{
						"max_size_bytes": maxSize,
						"uploaded_bytes": contentLength,
					},
				})
				return
			}
			// NOTE: Do NOT wrap body with MaxBytesReader here — ContentLength is already validated
			// and wrapping would interfere with the reverse proxy's body forwarding.
		}

		c.Next()
	}
}

func isArchiveExt(path string) bool {
	lower := strings.ToLower(path)
	for _, ext := range []string{".zip", ".cbz", ".rar", ".cbr", ".7z", ".cb7", ".pdf"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}
