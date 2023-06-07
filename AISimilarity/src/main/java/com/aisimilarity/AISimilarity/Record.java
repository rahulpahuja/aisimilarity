package com.aisimilarity.AISimilarity;

import java.util.Objects;

public class Record {
	

	private PLATFORM_TYPE type;
	private String section;
	private String controlName;
	private String hyperLink;
	private String platform;
	
	@Override
	public String toString() {
		return "Record [type=" + type + ", section=" + section + ", controlName=" + controlName + ", hyperLink="
				+ hyperLink + ", platform=" + platform + "]";
	}
	
	
	public PLATFORM_TYPE getType() {
		return type;
	}
	public void setType(PLATFORM_TYPE type) {
		this.type = type;
	}
	public String getSection() {
		return section;
	}
	public void setSection(String section) {
		this.section = section;
	}
	public String getControlName() {
		return controlName;
	}
	public void setControlName(String controlName) {
		this.controlName = controlName;
	}
	public String getHyperLink() {
		return hyperLink;
	}
	public void setHyperLink(String hyperLink) {
		this.hyperLink = hyperLink;
	}
	public String getPlatform() {
		return platform;
	}
	public void setPlatform(String platform) {
		this.platform = platform;
	}
	public static enum PLATFORM_TYPE{
		HYBIRD,
		NATIVE,
		CROSS_PLATFORM
	}
	
	
	@Override
	public int hashCode() {
		return Objects.hash(controlName, hyperLink, platform, section, type);
	}
	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		Record other = (Record) obj;
		return Objects.equals(controlName, other.controlName) && Objects.equals(hyperLink, other.hyperLink)
				&& Objects.equals(platform, other.platform) && Objects.equals(section, other.section)
				&& type == other.type;
	}
	
	
	
}
