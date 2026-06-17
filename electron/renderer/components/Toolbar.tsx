import { useEffect, useRef, useState } from "react";
import { Badge, Button, Text, Title3 } from "@fluentui/react-components";

type Props = {
  disabled: boolean;
  email: string;
  onRefresh(): void;
  onScanAll(): void;
  onClearCache(): void;
  onCheckUpdate(): void;
  onEditSettings(): void;
};

export function Toolbar({ disabled, email, onRefresh, onScanAll, onClearCache, onCheckUpdate, onEditSettings }: Props) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMoreOpen) {
      return undefined;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (moreMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsMoreOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMoreOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMoreOpen]);

  useEffect(() => {
    if (disabled) {
      setIsMoreOpen(false);
    }
  }, [disabled]);

  function runMoreAction(action: () => void) {
    setIsMoreOpen(false);
    action();
  }

  return (
    <section className="panel toolbar" role="region" aria-label="邮箱工具栏">
      <div className="toolbar-title">
        <Title3 as="h1">订单快读</Title3>
        <div className="account-line">
          <Badge appearance="tint" color="brand">
            已连接
          </Badge>
          <Text className="account-email">{email}</Text>
        </div>
      </div>
      <div className="toolbar-actions">
        <Button appearance="primary" disabled={disabled} onClick={onRefresh}>
          刷新
        </Button>
        <Button disabled={disabled} onClick={onScanAll}>
          同步近一个月
        </Button>
        <div className="toolbar-more" ref={moreMenuRef}>
          <Button
            aria-expanded={isMoreOpen}
            aria-haspopup="menu"
            disabled={disabled}
            onClick={() => setIsMoreOpen((current) => !current)}
          >
            更多操作
          </Button>
          {isMoreOpen ? (
            <div className="toolbar-more-menu" role="menu" aria-label="更多操作">
              <Button appearance="subtle" className="toolbar-more-item" role="menuitem" onClick={() => runMoreAction(onClearCache)}>
                清空缓存
              </Button>
              <Button appearance="subtle" className="toolbar-more-item" role="menuitem" onClick={() => runMoreAction(onCheckUpdate)}>
                检查更新
              </Button>
              <Button appearance="subtle" className="toolbar-more-item" role="menuitem" onClick={() => runMoreAction(onEditSettings)}>
                修改邮箱设置
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
