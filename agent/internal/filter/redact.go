package filter

import "regexp"

const Redacted = "[REDACTED]"

// Common secret shapes. Errs on the side of redacting.
var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`),
	regexp.MustCompile(`\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}`),           // Anthropic / OpenAI style keys
	regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),              // AWS access key id
	regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}`), // GitHub tokens
	regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{30,}`),
	regexp.MustCompile(`\bxox[abposr]-[A-Za-z0-9-]{10,}`),                                 // Slack
	regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`),                                       // Google API key
	regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`), // JWT
	regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*`),
	regexp.MustCompile(`(?i)\b[a-z]+://[^\s:/@]+:[^\s@/]+@`), // credentials in URLs
}

// key = value / key: value where the key names a secret.
var secretAssign = regexp.MustCompile(`(?i)\b([A-Z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Z0-9_.-]*)(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"'\n]+)`)

// .env-style lines: UPPER_CASE=value with a long value.
var envLine = regexp.MustCompile(`(?m)^(\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}=)(\S{12,})\s*$`)

func Redact(s string) string {
	for _, re := range secretPatterns {
		s = re.ReplaceAllString(s, Redacted)
	}
	s = secretAssign.ReplaceAllString(s, "${1}${2}"+Redacted)
	return envLine.ReplaceAllString(s, "${1}"+Redacted)
}
