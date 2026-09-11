# publish — 安装与开发命令
#
#   make install      安装到 ~/.local/bin（可用 PREFIX=/usr/local make install）
#   make uninstall    卸载
#   make smoke        校验安装结果（只做 dry-run，不会真的发布）
#   make check        类型检查 + 单元测试
#   make help         查看全部目标

SHELL      := /bin/bash
.DEFAULT_GOAL := help

PREFIX     ?= $(HOME)/.local
BINDIR     ?= $(PREFIX)/bin
DESTDIR    ?=
BUN        ?= bun
FORCE      ?= 0

# 入口与对外命令名（pub 是简写）
ENTRY      := $(CURDIR)/src/index.ts
LAUNCHERS  := publish pub

.PHONY: help install uninstall reinstall smoke test typecheck check deps link unlink dev doctor version where clean-bak

help: ## 显示帮助
	@printf '\n%s\n' "publish — 把观点发到小红书 / X / 知乎"
	@printf '%s\n\n' "基于 opencli 浏览器桥；默认后台窗口；内置人类化随机延迟与风控护栏。"
	@printf '%s\n' "可用目标："
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf '\n%s\n\n' "变量：PREFIX=$(PREFIX)  BINDIR=$(BINDIR)  BUN=$(BUN)"

install: ## 安装 CLI 到 ~/.local/bin（PREFIX/BINDIR 可覆盖）
	@command -v $(BUN) >/dev/null 2>&1 || { printf '✖ 找不到 bun，请先安装：https://bun.sh\n'; exit 1; }
	@test -f "$(ENTRY)" || { printf '✖ 找不到入口文件：%s\n' "$(ENTRY)"; exit 1; }
	@mkdir -p "$(DESTDIR)$(BINDIR)"
	@chmod +x "$(ENTRY)"
	@for name in $(LAUNCHERS); do \
	  target="$(DESTDIR)$(BINDIR)/$$name"; \
	  if [ -e "$$target" ] && [ ! -L "$$target" ]; then \
	    if [ "$(FORCE)" = "1" ]; then \
	      rm -f "$$target"; \
	    else \
	      backup="$$target.bak.$$(date +%Y%m%d%H%M%S)"; \
	      mv "$$target" "$$backup"; \
	      printf '▲ %s 已存在且不是链接，已备份为 %s\n' "$$target" "$$backup"; \
	    fi; \
	  fi; \
	  ln -sfn "$(ENTRY)" "$$target"; \
	  printf '✔ 已安装 %s -> %s\n' "$$target" "$(ENTRY)"; \
	done
	@case ":$$PATH:" in \
	  *:"$(BINDIR)":*) printf '✔ %s 已在 PATH 中\n' "$(BINDIR)" ;; \
	  *) printf '▲ %s 不在 PATH 中，请把下面一行加到 ~/.zshrc 或 ~/.bashrc：\n' "$(BINDIR)"; \
	     printf '    export PATH="%s:$$PATH"\n' "$(BINDIR)" ;; \
	esac
	@resolved="$$(command -v publish 2>/dev/null || true)"; \
	 if [ -n "$$resolved" ] && [ "$$resolved" != "$(DESTDIR)$(BINDIR)/publish" ]; then \
	   printf '▲ PATH 中更靠前的 publish 是 %s（可能是 bun link 装的），可用 make unlink 移除\n' "$$resolved"; \
	 fi
	@if [ -z "$(DESTDIR)" ]; then $(MAKE) --no-print-directory smoke; fi

uninstall: ## 卸载（只删指向本项目的符号链接）
	@for name in $(LAUNCHERS); do \
	  target="$(DESTDIR)$(BINDIR)/$$name"; \
	  if [ -L "$$target" ]; then \
	    dest="$$(readlink "$$target")"; \
	    if [ "$$dest" = "$(ENTRY)" ]; then rm -f "$$target"; printf '✔ 已移除 %s\n' "$$target"; \
	    else printf '▲ 跳过 %s（指向 %s，不是本项目）\n' "$$target" "$$dest"; fi; \
	  elif [ -e "$$target" ]; then printf '▲ 跳过 %s（不是符号链接）\n' "$$target"; \
	  else printf '· %s 不存在\n' "$$target"; fi; \
	done

reinstall: uninstall install ## 重新安装

smoke: ## 校验已安装的 CLI（dry-run，不发布）
	@printf '→ 校验 %s/publish\n' "$(BINDIR)"
	@"$(BINDIR)/publish" --version
	@"$(BINDIR)/publish" platforms --json >/dev/null && printf '✔ platforms 正常\n'
	@"$(BINDIR)/publish" routes path >/dev/null && printf '✔ route 目录解析正常\n'
	@"$(BINDIR)/publish" -c "make install smoke" -to xhs --dry-run --json >/dev/null && printf '✔ dry-run 正常（未做任何写操作）\n'
	@printf '✔ 安装可用\n'

where: ## 显示安装位置
	@printf 'BINDIR=%s\nENTRY =%s\n' "$(BINDIR)" "$(ENTRY)"
	@for name in $(LAUNCHERS); do target="$(BINDIR)/$$name"; [ -e "$$target" ] && ls -l "$$target" || printf '· %s 未安装\n' "$$target"; done

dev: ## 直接用 bun 运行（开发）
	@$(BUN) run "$(ENTRY)"

doctor: ## 运行 publish doctor
	@$(BUN) run "$(ENTRY)" doctor

version: ## 打印版本
	@$(BUN) run "$(ENTRY)" --version

deps: ## 安装开发依赖
	@$(BUN) install

test: ## 运行单元测试（全部使用假 opencli）
	@$(BUN) test

typecheck: ## TypeScript 类型检查
	@$(BUN) x tsc --noEmit

check: typecheck test ## 类型检查 + 测试

link: ## 用 bun link 安装到 ~/.bun/bin（与 make install 二选一）
	@$(BUN) link

unlink: ## 取消 bun link
	@$(BUN) unlink

clean-bak: ## 清理 install 产生的 .bak 备份
	@rm -f "$(BINDIR)"/publish.bak.* "$(BINDIR)"/pub.bak.* && printf '✔ 已清理备份文件\n'

