#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(jsonlite)
  library(httr)
})

args <- commandArgs(trailingOnly = TRUE)
features_path <- if (length(args) >= 1) args[[1]] else file.path("Thoteins","data","proteins","features.csv")
out_dir <- file.path("Thoteins","data","oncokb")
out_csv <- if (length(args) >= 2) args[[2]] else file.path(out_dir, "alignments.csv")
token <- Sys.getenv("ONCOKB_API_TOKEN", unset = "")

if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

message("[onco] Reading features: ", features_path)
dat <- tryCatch(read.csv(features_path, stringsAsFactors = FALSE), error = function(e) NULL)
if (is.null(dat) || is.null(dat$gene_symbol)) {
  stop("Couldn't read features.csv or missing gene_symbol column: ", features_path)
}

genes <- unique(na.omit(trimws(dat$gene_symbol)))
genes <- genes[genes != ""]

fetch_role <- function(sym) {
  if (token == "") return("unknown")
  url <- paste0("https://www.oncokb.org/api/v1/genes/lookup?query=", URLencode(sym))
  resp <- tryCatch(httr::GET(url, httr::add_headers(`X-API-KEY` = token, `Accept` = "application/json", `User-Agent` = "Thoteins/1.0"), timeout(15)), error = function(e) NULL)
  if (is.null(resp) || httr::http_error(resp)) return("unknown")
  txt <- httr::content(resp, as = "text", encoding = "UTF-8")
  obj <- tryCatch(jsonlite::fromJSON(txt), error = function(e) NULL)
  items <- if (is.data.frame(obj) || is.list(obj)) obj else NULL
  if (is.null(items)) return("unknown")
  pick <- NULL
  if (is.data.frame(items)) {
    if ("hugoSymbol" %in% names(items)) {
      idx <- which(toupper(items$hugoSymbol) == toupper(sym))
      if (length(idx) > 0) pick <- items[idx[1], , drop = FALSE]
    }
    if (is.null(pick) && nrow(items) >= 1) pick <- items[1, , drop = FALSE]
  } else if (is.list(items)) {
    if (!is.null(items$hugoSymbol)) pick <- items
  }
  if (is.null(pick)) return("unknown")
  og <- FALSE; ts <- FALSE
  try(og <- isTRUE(pick$oncogene), silent = TRUE)
  try(ts <- isTRUE(pick$tumorSuppressor), silent = TRUE)
  if (og && ts) return("both")
  if (og) return("oncogene")
  if (ts) return("tumor_suppressor")
  return("unknown")
}

message("[onco] Annotating ", length(genes), " genes via OncoKB...")
res <- data.frame(gene_symbol = genes, alignment = "unknown", stringsAsFactors = FALSE)
if (token == "") {
  message("[onco] ONCOKB_API_TOKEN not set; writing 'unknown' for all.")
} else {
  for (i in seq_along(genes)) {
    sym <- genes[[i]]
    role <- fetch_role(sym)
    res$alignment[i] <- role
    if (i %% 10 == 0) message(sprintf("[onco] %d/%d ... %s = %s", i, length(genes), sym, role))
  }
}

message("[onco] Writing ", out_csv)
write.csv(res, out_csv, row.names = FALSE)
message("[onco] Done.")

