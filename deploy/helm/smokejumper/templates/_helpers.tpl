{{- define "smokejumper.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "smokejumper.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "smokejumper.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "smokejumper.labels" -}}
helm.sh/chart: {{ include "smokejumper.chart" . }}
app.kubernetes.io/name: {{ include "smokejumper.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "smokejumper.serviceAccountName" -}}
{{- default (printf "%s-server" (include "smokejumper.fullname" .)) .Values.serviceAccount.name -}}
{{- end -}}

{{- define "smokejumper.secretName" -}}
{{- printf "%s-secrets" (include "smokejumper.fullname" .) -}}
{{- end -}}

{{- define "smokejumper.encryptionSecretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "smokejumper.secretName" . -}}
{{- end -}}
{{- end -}}

{{- define "smokejumper.configName" -}}
{{- printf "%s-config" (include "smokejumper.fullname" .) -}}
{{- end -}}

{{- define "smokejumper.postgresHost" -}}
{{- printf "%s-postgres" (include "smokejumper.fullname" .) -}}
{{- end -}}

{{- define "smokejumper.databaseUrl" -}}
{{- if .Values.postgres.enabled -}}
{{- printf "postgres://%s:%s@%s:5432/%s" .Values.postgres.username .Values.postgres.password (include "smokejumper.postgresHost" .) .Values.postgres.database -}}
{{- else -}}
{{- required "externalDatabase.url is required when postgres.enabled=false" .Values.externalDatabase.url -}}
{{- end -}}
{{- end -}}
