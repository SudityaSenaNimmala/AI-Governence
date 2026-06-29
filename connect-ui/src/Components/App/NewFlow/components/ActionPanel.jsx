import { Eye, EyeOff, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";

const ActionPanel = ({
  action,
  onEdit,
  onDelete,
  showDelete = true,
  borderColor,
  backgroundColor,
  icon,
  title,
  subtitle,
  imageSrc,
  imageAlt,
  isRhombus = false,
  deleted = false,
  isVisible = true,
  flowVisibleActions,
  disableEdit = false,
}) => {
  return (
    <div
      className={`cf_newFlow_trigger_pannel cf_action_trigger_dottedParent ${isRhombus ? "cf_newFlow_trigger_pannel_rhombus" : ""
        } ${deleted ? "cf_action_panel_deleted" : ""}`}
      style={{
        marginTop: isRhombus ? "85px" : "60px",
        border: `2px solid ${deleted ? "#ff4c4c" : borderColor}`,
        background: deleted
          ? "#E5E5E5"
          : backgroundColor,
        opacity: 1,
        position: "relative",
      }}
    >
      {
        flowVisibleActions &&
        (<div
          className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
          onClick={flowVisibleActions}
          style={{ right: "30px", }}
        >
          {isVisible ? <Eye size={10} /> : <EyeOff size={10} />}
        </div>)
      }
      {showDelete && onDelete && (
        <div
          className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
          onClick={onDelete}
          style={{ transform: isRhombus ? "rotate(-45deg)" : "rotate(0deg)" }}
        >
          <Trash2 size={10} />
        </div>
      )}
      {onEdit && !deleted && !disableEdit && (
        <div
          className="cf_newFlow_trigger_pannel_action_icon"
          style={{
            right: showDelete && onDelete ? "30px" : "0px",
          }}
          onClick={onEdit}
        >
          <Pencil size={10} />
        </div>
      )}
      <div
        className="cf_newFlow_trigger_pannel_header"
        style={
          isRhombus
            ? {
              flexDirection: "column",
              width: "100%",
              transform: "rotate(-45deg)",
              marginTop: "10px",
              marginLeft: "10px",
            }
            : {}
        }
      >
        {deleted ? (
          <div className="cf_newFlow_trigger_pannel_header_icon">
            <TriangleAlert size={22} color="#ff4c4c" />
          </div>
        ) : (
          <>
            {icon && (
              <div className="cf_newFlow_trigger_pannel_header_icon">{icon}</div>
            )}
            {imageSrc && (
              <img
                src={imageSrc}
                style={{
                  width: "20px",
                  height: "20px",
                  objectFit: "contain",
                }}
                alt={imageAlt}
              />
            )}
          </>
        )}
        <div
          className="CF_d-flex"
          style={{
            flexDirection: "column",
            width: isRhombus ? "100%" : "calc(100% - 50px)",
          }}
        >
          <p
            className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
            style={{
              width: "calc(100% - 0px)",
              fontWeight: "500",
            }}
            title={title + " " + subtitle}
          >
            {title}
          </p>
          {subtitle && (
            <p
              className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
              style={{
                fontWeight: "400",
                color: "#64748b",
              }}
              title={subtitle}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActionPanel;
