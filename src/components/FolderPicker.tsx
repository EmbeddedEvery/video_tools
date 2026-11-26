type Props = {
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
  label?: string;
};

export function FolderPicker({
  value,
  onChange,
  disabled,
  label = "工作文件夹",
}: Props) {
  async function pick() {
    const path = await window.videoTools.selectFolder();
    if (path) onChange(path);
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker__label">{label}</div>
      <div className="folder-picker__row">
        <div className={`folder-picker__path ${value ? "" : "is-empty"}`}>
          {value || "尚未选择文件夹"}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={pick}
          disabled={disabled}
        >
          选择文件夹
        </button>
      </div>
    </div>
  );
}
